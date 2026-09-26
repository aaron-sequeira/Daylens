import { app, BrowserWindow, Menu, Tray, powerMonitor, dialog, shell, utilityProcess, globalShortcut, screen, safeStorage } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { statfs, writeFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { createKvStore, createRepositories, createTracker, openDatabase, systemClock } from '@worksight/core';
import { ActiveWinForegroundSource, UiohookInputSource } from '@worksight/core/adapters';
import { localDate } from '@worksight/core/date';
import { complete, type AiProvider } from '@worksight/core/ai';
import { CH } from './channels';
import { registerIpc } from './ipc';
import { DEFAULT_SETTINGS } from './settings';
import { createOcrClient } from './ocr/client';
import { SCREEN_SCHEMA, createScreenStore, checkpoint, deleteActivity, exportAll } from './screen/store';
import { createScreenReader, runRetention } from './screen/reader';
import { readProfile } from './profile';
import { createLabelStore } from './screen/labels';
import { createLabelScheduler, type BrainChild } from './brain/scheduler';
import { createDownloader, type ModelStatus } from './models/downloader';
import { LAYA_MANIFEST } from './models/manifest';
import { batchAllowed, LAYA_NEED_BYTES } from './brain/resources';
import { COACH_SCHEMA, createCoachStore } from './coach/store';
import { createCoach } from './coach/engine';
import { planOverrides } from './coach/plan';
import { ruleWeight } from './coach/weights';
import { holdReason, type Rect } from './coach/gate';
import { queryNotificationState } from './coach/notifState';
import { parseFewer, parseKinds, parseLimits } from './coach/settings';
import { repeatedSearches, searchTitlesFrom, switchesBetween } from './coach/activity';
import { limitUsage } from './coach/rules/behaviour';
import { parseExclusions } from './screen/exclusions';
import { createPillManager, pillMessage, PILL_W, PILL_MARGIN } from './windows/pill';
import { electronPillWindow } from './windows/pillElectron';
import { createBreakOverlay, breakMessage } from './windows/breakOverlay';
import { electronBreakWindow } from './windows/breakOverlayElectron';
import { loadTodayView, type TimelineSegment } from './day/today';
import { dayBounds, shiftDate } from './day/time';
import { createSecretStore } from './writer/secrets';
import { resolveTier, tierFor, writerManifest, writerNeedBytes, WRITER_ATTRIBUTION, WRITER_MODELS, type WriterTier } from './writer/config';
import { countsAsFailure, localUnavailable, type Unavailable } from './writer/availability';
import { createWriter } from './writer/writer';
import { runLocal, type WriterChild } from './writer/run';
import { createReportStore, REPORT_SQL } from './report/store';
import { exportPdf, pdfFileName } from './windows/reportPdf';
import { renderReportPdf } from './windows/reportPdfElectron';
import { createReportScheduler, type ReportScheduler } from './report/scheduler';
import { friendlyReason, generateReport } from './report/generate';
import { batteryPercent } from './report/battery';
import { buildEpisodes } from './report/episodes';
import { buildCandidates } from './report/candidates';
import { buildReportInput, buildStats, forCloud, type ReportStats } from './report/input';
import type { ReportCandidate } from './report/candidates';
import { writerState, navDates, needGb, type ReportView, type WriterView } from './report/view';

app.setName('Daylens');
const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let stopTracking = (): void => {}; // set once the tracker exists
const DISMISS_ALL_KEY = 'Control+Alt+D';

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1100, minHeight: 720, show: false, backgroundColor: '#FBF8F4',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#FBF8F4', symbolColor: '#171717', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => { if (!startHidden) win?.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  // Windows shutdown/logoff doesn't emit before-quit: close the open session and flush the last bucket here.
  win.on('session-end', () => { quitting = true; stopTracking(); });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // The renderer never navigates or opens windows; allow only dev-server reloads (Vite HMR full reload).
  win.webContents.on('will-navigate', (e, url) => {
    if (!devUrl || new URL(url).origin !== new URL(devUrl).origin) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow(): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    const db = openDatabase(join(app.getPath('userData'), 'daylens.sqlite'));
    // WAL mode alone leaves purged/deleted text sitting in free pages and old WAL frames; secure_delete
    // makes SQLite actually overwrite them (paired with checkpoint() after a delete/retention run).
    db.pragma('secure_delete = ON');
    const repo = createRepositories(db);
    const settings = createKvStore(db, DEFAULT_SETTINGS);
    db.exec(SCREEN_SCHEMA);
    const screenStore = createScreenStore(db);
    // Existing users who already enabled reading in Phase 3 have answered the opt-in question.
    if (settings.get().screenReading && !settings.get().screenReadingAsked) settings.set({ screenReadingAsked: true });
    const labelStore = createLabelStore(db);
    db.exec(COACH_SCHEMA);
    const coachStore = createCoachStore(db);
    // Created early: buildSnapshot (below) needs it for plan overrides.
    db.exec(REPORT_SQL);
    const reportStore = createReportStore(db);
    reportStore.clearPending(Date.now());
    // DAYLENS_MODEL_DIR points at a dev folder holding the only exported copy of the model: read-only.
    const devModelDir = process.env['DAYLENS_MODEL_DIR'] || undefined;
    const modelDir = devModelDir ?? join(app.getPath('userData'), 'models', 'laya');
    let lastModelPush = 0;
    const downloader = createDownloader({
      dir: modelDir, manifest: LAYA_MANIFEST, fetch: globalThis.fetch, readOnly: devModelDir !== undefined,
      freeBytes: async (d) => { const s = await statfs(d); return s.bavail * s.bsize; },
      onStatus: (st) => {
        const t = Date.now();
        if (st.state === 'downloading' && t - lastModelPush < 2000) return; // progress pushes at most 1/2s
        lastModelPush = t;
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const forkBrain = (): BrainChild => {
      const child = utilityProcess.fork(join(__dirname, 'brain.js'), [], { serviceName: 'Daylens Brain', stdio: 'ignore' });
      // Electron emits 'error' (then 'exit') when the Brain crashes; an unhandled 'error' would throw in main.
      // The 'exit' that follows is what fails the batch.
      child.on('error', (type) => console.error('[brain] utility process error:', type));
      return {
        post: (m) => child.postMessage(m),
        onMessage: (cb) => { child.on('message', cb); },
        onExit: (cb) => { child.on('exit', cb); },
        kill: () => { child.kill(); }
      };
    };
    // Assigned once the report scheduler exists (after the coach wiring, below); the label scheduler's
    // canStart is defined before that, so it forward-references this holder rather than the scheduler itself.
    let reportScheduler!: ReportScheduler;
    const scheduler = createLabelScheduler({
      store: labelStore, fork: forkBrain, modelReady: () => downloader.status().state === 'ready',
      modelDir, now: () => Date.now(), onChange: () => win?.webContents.send(CH.eventsUpdate),
      // Labelling and report writing must never run at the same time (both can be memory/CPU heavy).
      canStart: () => batchAllowed({
        freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: LAYA_NEED_BYTES
      }) && reportScheduler.running() === null
    });
    // Gate syncModel until the startup init() (which hashes the model on disk) has settled, so a settings
    // change landing mid-hash can't race it into starting/stopping a run init hasn't finished evaluating.
    let modelInitDone = false;
    const syncModel = (): void => {
      if (!modelInitDone || devModelDir) return; // never download into the dev folder
      const s = settings.get();
      if (s.screenReading && s.consentGranted) downloader.start(); else downloader.stop();
    };
    const tickScheduler = (): void => {
      // No labelling batches while tracking is paused (the reader already stops capturing then).
      if (settings.get().trackingPaused) return;
      try { scheduler.tick(); } catch (e) { console.error('[brain] tick failed:', e); }
    };
    setInterval(tickScheduler, 60_000);
    // ponytail: dev path; Phase 7 packaging must ship resources/ocr-helper.ps1 via extraResources.
    const helperPath = app.isPackaged ? join(process.resourcesPath, 'ocr-helper.ps1') : join(__dirname, '../../resources/ocr-helper.ps1');
    const ocr = createOcrClient({
      // stderr is ignored, not piped: an undrained stderr pipe can fill up and block the helper.
      spawn: () => spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }),
      onStatus: () => win?.webContents.send(CH.eventsUpdate)
    });

    const loadPage = (w: BrowserWindow, page: 'pill' | 'break'): void => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (devUrl) void w.loadURL(`${devUrl}/${page}.html`);
      else void w.loadFile(join(__dirname, `../renderer/${page}.html`));
    };
    const overlay = createBreakOverlay({
      displays: () => screen.getAllDisplays().map((dsp) => ({ bounds: dsp.bounds, primary: dsp.id === screen.getPrimaryDisplay().id })),
      makeWindow: (bounds) => electronBreakWindow(bounds, join(__dirname, '../preload/break.js'), (w) => loadPage(w, 'break'), (raw) => {
        const m = breakMessage.safeParse(raw);
        if (m.success) overlay.handle(m.data);
      }),
      onDone: (r) => {
        const now = Date.now();
        coachStore.recordBreak({ at: now, date: localDate(now), kind: r.kind, seconds: r.seconds, completed: r.completed });
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const primaryActions = new Map<number, { kind: string; action: string }>();
    let testPillId = 0; // decrementing counter for "Test a pop-up": unique negative ids, never collide with real (positive) nudge ids
    const pill = createPillManager({
      makeWindow: () => electronPillWindow(join(__dirname, '../preload/pill.js'), (w) => loadPage(w, 'pill'), (raw) => {
        const m = pillMessage.safeParse(raw);
        if (m.success) pill.handle(m.data);
      }),
      placement: () => {
        const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        return { x: wa.x + wa.width - PILL_W - PILL_MARGIN, y: wa.y + PILL_MARGIN };
      },
      // Ctrl+Alt+D is AltGr+D on many Windows layouts: hold it only while pills are on screen.
      onVisible: (visible) => {
        if (!visible) { globalShortcut.unregister(DISMISS_ALL_KEY); return; }
        if (!globalShortcut.isRegistered(DISMISS_ALL_KEY) && !globalShortcut.register(DISMISS_ALL_KEY, () => pill.dismissAll())) {
          console.warn('[coach] Ctrl+Alt+D is taken by another app');
        }
      },
      onAction: (id, action) => {
        if (id < 0) return; // "Test a pop-up"
        const meta = primaryActions.get(id);
        primaryActions.delete(id);
        const status = action === 'primary' ? 'acted' : action === 'dismiss' || action === 'fewer' ? 'dismissed' : action === 'snooze' ? 'snoozed' : 'expired';
        coachStore.setStatus(id, status);
        if (action === 'snooze') settings.set({ snoozeUntil: Date.now() + 3_600_000 });
        if (action === 'fewer' && meta) {
          const fewer = parseFewer(settings.get().nudgeFewer);
          const k = meta.kind as keyof typeof fewer;
          settings.set({ nudgeFewer: JSON.stringify({ ...fewer, [k]: Math.min(64, (fewer[k] ?? 1) * 2) }) });
        }
        if (action === 'primary' && meta?.action === 'break_eye') overlay.start('eye');
        if (action === 'primary' && meta?.action === 'break_stretch') overlay.start('stretch');
        refreshTray();
        win?.webContents.send(CH.eventsUpdate);
      }
    });
    const buildSnapshot = (now: number) => {
      const s = settings.get();
      const date = localDate(now);
      const view = loadTodayView(repo, s, date, now, (d) => labelStore.labelsForDay(d), (d) => coachStore.completedBreaksForDay(d));
      const searchTitles = searchTitlesFrom(Array.from({ length: 7 }, (_, i) => repo.getFocusSessions(shiftDate(date, -i))).flat(), parseExclusions(s.exclusions));
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      const o = planOverrides(reportStore.plan(date), date);
      return {
        now, date, settings: { ...s, breakIntervalMin: o.breakIntervalMin ?? s.breakIntervalMin, windDownTime: o.windDownTime ?? s.windDownTime },
        profile: readProfile(s), samples: repo.getActivitySamples(date), sessions: repo.getFocusSessions(date),
        readsToday: labelStore.readsSince(dayStart.getTime()), // rules apply their own freshness windows
        view, searchTitles, limits: [...parseLimits(s.appLimits), ...o.limits], lastBreakAt: coachStore.lastCompletedBreakAt(), focusBlocks: o.focus
      };
    };
    const coach = createCoach({
      now: () => Date.now(),
      snapshot: buildSnapshot,
      history: (now) => coachStore.since(now - 7 * 86_400_000),
      kinds: () => parseKinds(settings.get().nudgeKinds),
      snoozeUntil: () => settings.get().snoozeUntil,
      fewer: () => parseFewer(settings.get().nudgeFewer),
      weight: (c, now) => ruleWeight(c.ruleId, c.kind, readProfile(settings.get()), now),
      holdReason: async () => {
        const fg = await new ActiveWinForegroundSource().get().catch(() => null);
        const displays: Rect[] = screen.getAllDisplays().map((dsp) => dsp.bounds);
        return holdReason(fg ? { appName: fg.appName, title: fg.title, bounds: fg.bounds ? screen.screenToDipRect(null, fg.bounds) : null } : null, displays, await queryNotificationState());
      },
      record: (c, status, now) => {
        const id = coachStore.record({ at: now, date: localDate(now), kind: c.kind, ruleId: c.ruleId, key: c.key, title: c.title, body: c.body, status });
        if (status === 'shown') primaryActions.set(id, { kind: c.kind, action: c.primary.action });
        return id;
      },
      setStatus: (id, st) => {
        coachStore.setStatus(id, st);
        if (st !== 'shown') primaryActions.delete(id); // only a 'shown' row still needs its primary-action metadata
      },
      show: (n) => pill.show(n)
    });
    let coaching = false;
    let lastSnoozed = settings.get().snoozeUntil > Date.now();
    setInterval(() => {
      const s = settings.get();
      const snoozed = s.snoozeUntil > Date.now();
      if (snoozed !== lastSnoozed) { lastSnoozed = snoozed; refreshTray(); }
      if (coaching || !s.consentGranted || s.trackingPaused) return;
      if (powerMonitor.getSystemIdleState(120) !== 'active') return; // no coaching while the user is away or locked
      coaching = true;
      coach.tick().catch((e) => console.error('[coach] tick failed:', e)).finally(() => { coaching = false; });
    }, 30_000);

    // --- Writer (local model + cloud) and the daily report scheduler (Task 7) ---
    const secrets = createSecretStore(db, {
      encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')),
      decrypt: (b) => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'))
    });
    // Declared before any downloader callback can use it.
    const writerHealth = { downloadFailures: 0, loadFailed: false, crashes: [] as number[], consecutiveTimeouts: 0 };
    const CRASH_WINDOW_MS = 10 * 60_000;
    const pushCrash = (): void => {
      const now = Date.now();
      writerHealth.crashes = [...writerHealth.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    };
    let freeDiskCache: number | null = null;
    let freeDiskAt = 0;
    // At most every 30 s unless forced (we just freed or filled the disk ourselves). statfs is async, so the fresh
    // number lands after the view that asked for it: push an update if it changes the writer's availability.
    const refreshFreeDisk = (force = false): void => {
      const now = Date.now();
      if (!force && now - freeDiskAt < 30_000) return;
      freeDiskAt = now;
      void statfs(app.getPath('userData')).then((s) => {
        const was = unavailable();
        freeDiskCache = s.bavail * s.bsize;
        if (unavailable() !== was) win?.webContents.send(CH.eventsUpdate);
      }).catch(() => {});
    };
    refreshFreeDisk(true);
    const writerTier = (): WriterTier => resolveTier(settings.get().writerModelTier, totalmem());
    const writerDirFor = (t: WriterTier): string => join(app.getPath('userData'), 'models', 'writer', t);
    const makeWriterDownloader = (t: WriterTier) => {
      let prevStatus: ModelStatus = { state: 'missing' };
      let lastRetryReceived: number | null = null;
      let lastPush = 0;
      return createDownloader({
        dir: writerDirFor(t), manifest: writerManifest(t), fetch: globalThis.fetch,
        freeBytes: async (d) => { const s = await statfs(d); return s.bavail * s.bsize; },
        onStatus: (st) => {
          // "Download failed twice" must be reachable: count real failed attempts, not every progress
          // tick. A fully blocked link retries forever with the same bytes on disk, so each retry that
          // makes no further progress since the last one counts on its own (not just the first), plus
          // every error. An installed model makes past failures irrelevant.
          if (countsAsFailure(prevStatus, st, lastRetryReceived)) writerHealth.downloadFailures++;
          if (st.state === 'downloading' && st.retrying) lastRetryReceived = st.received;
          if (st.state === 'ready') writerHealth.downloadFailures = 0;
          if (st.state === 'error' && st.reason === 'no_space') refreshFreeDisk(true);
          prevStatus = st;
          const now = Date.now();
          if (st.state === 'downloading' && now - lastPush < 2000) return; // progress pushes at most 1/2s
          lastPush = now;
          win?.webContents.send(CH.eventsUpdate);
        }
      });
    };
    let writerDl = makeWriterDownloader(writerTier());
    void writerDl.init().catch((e) => console.error('[writer] init failed:', e)); // verifies an existing file; never starts a download by itself
    const unavailable = (): Unavailable | null => {
      const st = writerDl.status();
      return localUnavailable({
        totalRam: totalmem(), freeDisk: freeDiskCache, model: WRITER_MODELS[writerTier()], installed: st.state === 'ready',
        downloadedBytes: st.state === 'downloading' ? st.received : 0,
        downloadFailures: writerHealth.downloadFailures, declined: settings.get().writerDeclined, loadFailed: writerHealth.loadFailed,
        crashes: writerHealth.crashes, consecutiveTimeouts: writerHealth.consecutiveTimeouts,
        autoPaused: reportScheduler?.autoPaused() ?? false, now: Date.now()
      });
    };
    const forkWriter = (): WriterChild => {
      const child = utilityProcess.fork(join(__dirname, 'writer.js'), [], { serviceName: 'Daylens Writer', stdio: 'ignore' });
      child.on('error', (type) => console.error('[writer] utility process error:', type));
      return { post: (m) => child.postMessage(m), onMessage: (cb) => { child.on('message', cb); }, onExit: (cb) => { child.on('exit', cb); }, kill: () => { child.kill(); } };
    };
    const writer = createWriter({
      mode: () => settings.get().writerMode,
      local: () => (writerDl.status().state === 'ready'
        ? { modelPath: join(writerDirFor(writerTier()), WRITER_MODELS[writerTier()].file), model: WRITER_MODELS[writerTier()].label }
        : null),
      runLocal: (req, ms) => runLocal(req, { fork: forkWriter, timeoutMs: ms }),
      cloud: (req, ms) => {
        const s = settings.get();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        return complete(req, { apiKey: secrets.get(s.aiProvider), model: s.aiModel, provider: s.aiProvider as AiProvider, baseUrl: s.aiBaseUrl, title: 'Daylens', signal: ctrl.signal })
          .finally(() => clearTimeout(t));
      },
      cloudModel: () => settings.get().aiModel
    });
    const buildReportFor = (date: string) => {
      const s = settings.get();
      const { end } = dayBounds(date);
      const now = Math.min(Date.now(), end);
      const view = loadTodayView(repo, s, date, now, (d) => labelStore.labelsForDay(d), (d) => coachStore.completedBreaksForDay(d));
      // Screen text never leaves the PC: the cloud writer gets episodes and candidates without samples.
      const cloud = s.writerMode === 'cloud';
      const episodes = buildEpisodes(labelStore.readsForDay(date), s.screenReading && !cloud);
      const sessions = repo.getFocusSessions(date);
      const titles = searchTitlesFrom(Array.from({ length: 7 }, (_, i) => repo.getFocusSessions(shiftDate(date, -i))).flat(), parseExclusions(s.exclusions));
      const candidates = buildCandidates({
        episodes, searches: repeatedSearches(titles),
        nudges: coachStore.since(dayBounds(date).start).filter((n) => n.date === date).map((n) => ({ id: n.id, ruleId: n.ruleId, title: n.title, status: n.status })),
        caps: limitUsage(parseLimits(s.appLimits), sessions, now)
      });
      const stats = buildStats(view, episodes, switchesBetween(sessions, dayBounds(date).start, now));
      const input = buildReportInput({ stats, episodes, candidates, goals: { dailyGoalMin: s.dailyGoalMin, windDownTime: s.windDownTime, breakIntervalMin: s.breakIntervalMin } });
      return {
        input: cloud ? forCloud(input) : input,
        candidateIds: new Set(candidates.map((c) => c.id)), view, candidates, stats
      };
    };
    // Bumped by "Delete my activity": a report written across it must not be stored.
    let reportEpoch = 0;
    // Set when the PC sleeps mid-write: that write's timeout / crash is the sleep's fault, not the writer's.
    let suspendedDuringWrite = false;
    reportScheduler = createReportScheduler({
      now: () => Date.now(),
      windDown: (d) => planOverrides(reportStore.plan(d), d).windDownTime ?? settings.get().windDownTime,
      row: (d) => reportStore.get(d),
      hasActivity: (d) => repo.getFocusSessions(d).length > 0,
      canWrite: () => (settings.get().writerMode === 'cloud' ? secrets.has(settings.get().aiProvider) : writerDl.status().state === 'ready' && unavailable() === null),
      gateOk: () => settings.get().writerMode === 'cloud' || batchAllowed({
        freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: writerNeedBytes(writerTier())
      }),
      otherJobRunning: () => scheduler.status().state === 'running',
      lowBattery: async () => powerMonitor.isOnBatteryPower() && ((await batteryPercent()) ?? 100) < 20,
      generate: async (date) => {
        suspendedDuringWrite = false;
        const outcome = await generateReport(date, { build: buildReportFor, writer, store: reportStore, now: () => Date.now(), epoch: () => reportEpoch });
        const slept = suspendedDuringWrite;
        suspendedDuringWrite = false;
        if (slept && (outcome === 'timeout' || outcome === 'crash')) {
          // Not counted (no crash, no timeout). Drop the failed row so the automatic rule writes the day again later;
          // a kept good report (failed regenerate) stays.
          if (reportStore.get(date)?.status !== 'ready') reportStore.delete(date);
          return 'failed';
        }
        if (outcome === 'crash') pushCrash();
        if (outcome === 'load') writerHealth.loadFailed = true;
        writerHealth.consecutiveTimeouts = outcome === 'timeout' ? writerHealth.consecutiveTimeouts + 1 : outcome === 'ok' ? 0 : writerHealth.consecutiveTimeouts;
        return outcome;
      },
      onChange: () => win?.webContents.send(CH.eventsUpdate)
    });
    setInterval(() => { void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e)); }, 60_000);
    const reportView = (date: string | null): ReportView => {
      refreshFreeDisk();
      const rows = reportStore.dates();
      const today = localDate(Date.now());
      const d = date ?? rows[0] ?? today;
      const row = reportStore.get(d);
      let stats: ReportStats | null = null;
      let timeline: TimelineSegment[] = [];
      let candidates: ReportCandidate[] = [];
      try {
        const built = buildReportFor(d);
        stats = built.stats;
        timeline = built.view.timeline;
        candidates = built.candidates;
      } catch (e) {
        console.error('[report] view build failed:', e);
      }
      const { prevDate, nextDate } = navDates(d, today, rows);
      const s = settings.get();
      return {
        date: d, prevDate, nextDate, today,
        // Rows stored before friendly reasons existed may hold a raw `load: <path>` error: never show that.
        status: row?.status ?? 'none', report: row?.report ?? null, error: row?.error?.startsWith('load:') ? friendlyReason(row.error) : row?.error ?? null, model: row?.model ?? null,
        stats, timeline, candidates, ticked: reportStore.tickedTexts(d),
        writer: writerState({ mode: s.writerMode, hasKey: secrets.has(s.aiProvider), cloudModel: s.aiModel, tier: writerTier(), model: writerDl.status(), unavailable: unavailable() }),
        waiting: reportScheduler.waiting() === d, running: reportScheduler.running() === d, autoPaused: reportScheduler.autoPaused(),
        needGb: needGb(writerTier())
      };
    };
    // Also refreshes free disk for download / retryLocal, which both answer with writerView().
    const writerView = (): WriterView => {
      refreshFreeDisk();
      const s = settings.get();
      return {
        state: writerState({ mode: s.writerMode, hasKey: secrets.has(s.aiProvider), cloudModel: s.aiModel, tier: writerTier(), model: writerDl.status(), unavailable: unavailable() }),
        mode: s.writerMode, tier: s.writerModelTier as '' | WriterTier, autoTier: tierFor(totalmem()),
        provider: s.aiProvider, model: s.aiModel, baseUrl: s.aiBaseUrl, hasKey: secrets.has(s.aiProvider), attribution: WRITER_ATTRIBUTION
      };
    };

    let lastPush = 0;
    // ponytail: drop pushes closer than 2 s; the renderer also polls every 30 s, so a dropped push only delays by <30 s.
    const pushUpdate = (): void => {
      const t = Date.now();
      if (t - lastPush < 2000) return;
      lastPush = t;
      win?.webContents.send(CH.eventsUpdate);
    };

    const tracker = createTracker({
      foreground: new ActiveWinForegroundSource(),
      input: new UiohookInputSource(),
      clock: systemClock,
      repo,
      getSettings: () => settings.get(),
      getSystemIdleSec: () => powerMonitor.getSystemIdleTime(),
      onUpdate: pushUpdate
    });
    stopTracking = () => tracker.stop();

    const reader = createScreenReader({
      ocr, foreground: new ActiveWinForegroundSource(), settings: () => settings.get(),
      idleSec: () => powerMonitor.getSystemIdleTime(), store: screenStore, now: () => Date.now(),
      // The BrowserWindow's HWND belongs to this process: never OCR our own window.
      selfPid: process.pid,
      backlogBlocked: () => scheduler.backlogBlocked()
    });
    // The helper process only exists while screen reading is allowed to run.
    const syncOcr = (): void => {
      const s = settings.get();
      if (s.screenReading && s.consentGranted && !s.trackingPaused) ocr.start(); else ocr.stop();
    };
    // Runs at startup, before the tray/quit/power handlers below are registered, so a failure here must
    // not crash startup.
    const retention = (): void => {
      try {
        const purged = runRetention(screenStore, settings.get().rawTextRetentionDays, Date.now());
        if (purged > 0) checkpoint(db);
      } catch (e) {
        console.error('[screen] retention failed:', e);
      }
    };
    let reading = false;
    setInterval(() => {
      if (reading) return;
      reading = true;
      reader.tick().catch((e) => console.error('[screen] read failed:', e)).finally(() => { reading = false; });
    }, settings.get().readIntervalSec * 1000);
    setInterval(retention, 6 * 60 * 60 * 1000);

    function refreshTray(): void {
      const paused = settings.get().trackingPaused;
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Daylens', click: showWindow },
        { label: paused ? 'Resume tracking' : 'Pause tracking', click: () => setTracking(paused) },
        settings.get().snoozeUntil > Date.now()
          ? { label: 'Resume pop-ups', click: () => { settings.set({ snoozeUntil: 0 }); refreshTray(); } }
          : { label: 'Snooze pop-ups 1 h', click: () => { settings.set({ snoozeUntil: Date.now() + 3_600_000 }); refreshTray(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } }
      ]));
    }
    function setTracking(on: boolean): void {
      settings.set({ trackingPaused: !on });
      if (on && settings.get().consentGranted) tracker.start(); else tracker.stop();
      refreshTray();
      syncOcr();
      win?.webContents.send(CH.eventsUpdate);
    }
    const applyLoginItem = (): void => {
      // Only the packaged app registers itself; in dev this would register electron.exe.
      const s = settings.get();
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.consentGranted && s.openAtLogin, args: ['--hidden'] });
    };

    registerIpc({
      repo, settings, tracker, setTracking,
      onSettingsChanged: () => { applyLoginItem(); syncOcr(); syncModel(); retention(); },
      now: () => Date.now(),
      labelsFor: (date) => labelStore.labelsForDay(date),
      breaksFor: (date) => coachStore.completedBreaksForDay(date),
      coach: {
        held: () => coachStore.heldForDay(localDate(Date.now())).map(({ id, at, kind, title, body }) => ({ id, at, kind, title, body })),
        dismissHeld: (id) => { if (coachStore.expireHeld(id)) win?.webContents.send(CH.eventsUpdate); },
        test: () => { pill.show({ id: --testPillId, kind: 'health', mini: 'Eye break', stat: 'test', title: 'Give your eyes a break', body: 'This is how Daylens pop-ups look. They never take your keyboard focus.', primaryLabel: 'Nice', offerFewer: false }); },
        onChanged: () => refreshTray()
      },
      reports: {
        view: (date) => reportView(date),
        generate: (date) => {
          const today = localDate(Date.now());
          // Future dates and a date already being written are both no-ops: just report the current view.
          if (date > today || reportScheduler.running() === date) return reportView(date);
          reportScheduler.request(date);
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e));
          return reportView(date);
        },
        tickPlan: (date, index, on) => {
          const item = reportStore.get(date)?.report?.plan[index];
          if (item) reportStore.tick(date, item, on);
          return reportView(date);
        },
        exportPdf: async (date) => {
          const { canceled, filePath } = await dialog.showSaveDialog(win!, {
            title: 'Export report as PDF', defaultPath: pdfFileName(date), filters: [{ name: 'PDF', extensions: ['pdf'] }]
          });
          if (canceled || !filePath) return { ok: false, cancelled: true };
          const r = await exportPdf(date, {
            render: (d) => renderReportPdf(d, {
              preload: join(__dirname, '../preload/index.js'),
              devUrl: process.env['ELECTRON_RENDERER_URL'],
              indexFile: join(__dirname, '../renderer/index.html')
            }),
            write: (p, b) => writeFile(p, b)
          }, filePath);
          return r === 'ok' ? { ok: true, path: filePath } : { ok: false, reason: r };
        }
      },
      plan: {
        today: () => reportStore.plan(localDate(Date.now())).map((p) => ({ id: p.id, text: p.item.text, enabled: p.enabled })),
        setEnabled: (id, on) => {
          reportStore.setEnabled(id, on);
          win?.webContents.send(CH.eventsUpdate);
          return reportStore.plan(localDate(Date.now())).map((p) => ({ id: p.id, text: p.item.text, enabled: p.enabled }));
        }
      },
      writer: {
        view: () => writerView(),
        download: () => { settings.set({ writerDeclined: false }); writerDl.start(); return writerView(); },
        remove: async () => {
          // Never delete the local model out from under a report that's actively being written with it.
          if (settings.get().writerMode === 'local' && reportScheduler.running() !== null) return writerView();
          writerDl.stop();
          await writerDl.remove();
          refreshFreeDisk(true); // the model's space was just freed
          return writerView();
        },
        decline: () => { settings.set({ writerDeclined: true }); return writerView(); },
        setMode: (m) => { settings.set({ writerMode: m }); return writerView(); },
        setTier: async (t) => {
          writerDl.stop(); // keep the old file: only settings + the downloader instance switch
          settings.set({ writerModelTier: t });
          writerDl = makeWriterDownloader(writerTier());
          await writerDl.init().catch((e) => console.error('[writer] init failed:', e));
          return writerView();
        },
        setCloud: (c) => {
          settings.set({ aiProvider: c.provider, aiModel: c.model, aiBaseUrl: c.baseUrl });
          if (c.key) secrets.set(c.provider, c.key);
          settings.set({ writerMode: 'cloud' });
          return writerView();
        },
        retryLocal: () => {
          writerHealth.loadFailed = false;
          writerHealth.crashes = [];
          writerHealth.consecutiveTimeouts = 0;
          writerHealth.downloadFailures = 0;
          settings.set({ writerDeclined: false });
          reportScheduler.resume();
          return writerView();
        }
      },
      models: {
        view: () => ({ model: downloader.status(), labelling: scheduler.status() }),
        redownload: async () => {
          if (devModelDir) {
            // The dev folder holds the only exported copy of the model: never delete it.
            console.warn('[models] DAYLENS_MODEL_DIR set: skipping redownload delete');
            return { model: downloader.status(), labelling: scheduler.status() };
          }
          const s = settings.get();
          if (!s.screenReading || !s.consentGranted) {
            // Deleting without screen reading on would never trigger a re-download.
            console.warn('[models] redownload requested with screen reading off: skipping delete');
            return { model: downloader.status(), labelling: scheduler.status() };
          }
          if (scheduler.status().state === 'running') {
            console.warn('[models] redownload requested while a labelling batch is running: skipping delete');
            return { model: downloader.status(), labelling: scheduler.status() };
          }
          try {
            await downloader.remove();
          } catch (e) {
            console.error('[models] redownload delete failed:', e);
            // remove() leaves status 'missing' even when the deletion itself failed; re-verify what's
            // actually on disk so labelling isn't stuck waiting on a model that's still there.
            await downloader.init().catch((ie) => console.error('[models] re-check failed:', ie));
            syncModel();
            return { model: downloader.status(), labelling: scheduler.status() };
          }
          syncModel();
          return { model: downloader.status(), labelling: scheduler.status() };
        },
        remove: async () => {
          if (devModelDir) {
            // The dev folder holds the only exported copy of the model: never delete it.
            console.warn('[models] DAYLENS_MODEL_DIR set: skipping delete');
            return { deleted: false };
          }
          if (scheduler.status().state === 'running') {
            console.warn('[models] delete requested while a labelling batch is running: skipping (no dialog)');
            return { deleted: false };
          }
          const r = await dialog.showMessageBox(win!, {
            type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Delete AI model',
            message: 'Delete the downloaded AI model?',
            detail: 'Screen reads stop being labelled until it is downloaded again (about 1.7 GB). If screen reading is on, the download starts again right away.'
          });
          if (r.response !== 0) return { deleted: false };
          try {
            await downloader.remove();
          } catch (e) {
            console.error('[models] delete failed:', e);
            // Same re-check as redownload: don't leave status falsely 'missing' after a failed deletion.
            await downloader.init().catch((ie) => console.error('[models] re-check failed:', ie));
            syncModel();
            return { deleted: false };
          }
          syncModel();
          return { deleted: true };
        },
        retryLabelling: () => { scheduler.retry(); tickScheduler(); return { model: downloader.status(), labelling: scheduler.status() }; }
      },
      privacy: {
        ocrStatus: () => ocr.status(),
        lastRead: () => screenStore.lastWithText(),
        exportData: async () => {
          const r = await dialog.showSaveDialog(win!, {
            title: 'Export your Daylens data', defaultPath: `daylens-export-${localDate(Date.now())}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }]
          });
          if (r.canceled || !r.filePath) return { saved: false };
          const s = settings.get();
          writeFileSync(r.filePath, JSON.stringify(exportAll(db, s, readProfile(s), Date.now()), null, 2), 'utf8');
          return { saved: true, path: r.filePath };
        },
        deleteActivity: async () => {
          const r = await dialog.showMessageBox(win!, {
            type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Delete my activity',
            message: 'Delete all your activity and screen text?',
            detail: "Screen time, app history, screen reads, daily reports and plan items will be erased from this PC. Your settings and answers are kept. This can't be undone."
          });
          if (r.response !== 0) return { deleted: false };
          const s = settings.get();
          const wasRunning = s.consentGranted && !s.trackingPaused;
          tracker.stop();
          ocr.stop();
          // A failed delete must not leave tracking/OCR silently off: restart them (and re-sync OCR)
          // whether deleteActivity succeeds or throws.
          try {
            reportEpoch++; // before the delete: an in-flight report write must not re-create a row afterwards
            deleteActivity(db);
            pill.dismissAll(); // any on-screen nudges reference rows that just got wiped
            checkpoint(db);
          } finally {
            if (wasRunning) tracker.start();
            syncOcr();
          }
          win?.webContents.send(CH.eventsUpdate);
          return { deleted: true };
        },
        openLanguageSettings: () => { void shell.openExternal('ms-settings:regionlanguage'); }
      }
    });
    createWindow();

    app.on('will-quit', () => globalShortcut.unregisterAll());

    // Start tracking BEFORE the tray: a tray failure must never prevent tracking.
    const s = settings.get();
    if (s.consentGranted && !s.trackingPaused) tracker.start();
    applyLoginItem();
    syncOcr();
    retention();
    downloader.init()
      .then(() => { modelInitDone = true; syncModel(); })
      .catch((e) => { modelInitDone = true; console.error('[models] init failed:', e); syncModel(); });

    try {
      tray = new Tray(app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png'));
      tray.setToolTip('Daylens');
      tray.on('click', showWindow);
      refreshTray();
    } catch (e) {
      console.error('[main] tray setup failed (tracking unaffected):', e);
    }

    app.on('before-quit', () => { quitting = true; tracker.stop(); ocr.stop(); downloader.stop(); writerDl.stop(); });
    // Sleep must not count as screen time: stop (closes the session, flushes the bucket) before suspend and
    // restart on wake. tracker.stop() is idempotent, so suspending while paused writes nothing.
    powerMonitor.on('suspend', () => {
      tracker.stop();
      if (reportScheduler.running()) suspendedDuringWrite = true;
    });
    powerMonitor.on('resume', () => {
      const cur = settings.get();
      if (cur.consentGranted && !cur.trackingPaused) tracker.start();
    });
  });
}

app.on('window-all-closed', () => { /* keep running in the tray */ });
