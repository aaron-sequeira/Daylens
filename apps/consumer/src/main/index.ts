import { app, BrowserWindow, Menu, Tray, powerMonitor, dialog, shell, utilityProcess, globalShortcut, screen, safeStorage } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
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
import { createCoach, type CoachDeps } from './coach/engine';
import { planOverrides } from './coach/plan';
import { ruleWeight } from './coach/weights';
import { holdReason, type Rect } from './coach/gate';
import { queryNotificationState } from './coach/notifState';
import { parseFewer, parseKinds, parseLimits } from './coach/settings';
import { repeatedSearches, searchTitlesFrom, switchesBetween } from './coach/activity';
import { limitUsage } from './coach/rules/behaviour';
import { parseTip, tipAllowedMinutes, tipInput, tipPrompt, tipRewriteAllowed, TIP_JSON_SCHEMA } from './coach/tip';
import { parseExclusions } from './screen/exclusions';
import { createPillManager, pillMessage, PILL_W, PILL_MARGIN } from './windows/pill';
import { electronPillWindow } from './windows/pillElectron';
import { createBreakOverlay, breakMessage } from './windows/breakOverlay';
import { electronBreakWindow } from './windows/breakOverlayElectron';
import { loadTodayView, type TimelineSegment } from './day/today';
import { dayBounds, shiftDate } from './day/time';
import { createSecretStore } from './writer/secrets';
import { resolveTier, tierFor, writerManifest, writerNeedBytes, WRITER_ATTRIBUTION, WRITER_MODELS, type WriterTier } from './writer/config';
import { countsAsFailure, localUnavailable, writerUsable, type Unavailable } from './writer/availability';
import { createWriter } from './writer/writer';
import { runLocal, type WriterChild } from './writer/run';
import { createReportStore, REPORT_SQL } from './report/store';
import { groundText } from './report/schema';
import { createReportSearch, reportBody, REPORT_FTS_SQL } from './report/search';
import { exportPdf, pdfFileName } from './windows/reportPdf';
import { renderReportPdf } from './windows/reportPdfElectron';
import { autoSavePath, autoSavePdf, checkFolder, mailtoUrl } from './report/share';
import { createPdfQueue } from './report/pdfQueue';
import { createReportScheduler, MIN_AUTO_SCREEN_SEC, weekDueKey, type ReportScheduler } from './report/scheduler';
import { friendlyReason, generateReport, generateWeek } from './report/generate';
import { buildInsights, buildWeekInput, canGenerateWeek, createWeeklyStore, weekDates, weekStart, WEEKLY_SQL, type InsightsDay, type InsightsNumbers, type WeekInput } from './report/week';
import type { InsightsView } from './ipc';
import { batteryPercent } from './report/battery';
import { buildEpisodes, deepWorkSec } from './report/episodes';
import { buildCandidates } from './report/candidates';
import { buildDayDetail, type DayDetail } from './report/detail';
import { finalCategory } from './brain/finalCategory';
import { buildReportInput, buildStats, buildWeek, forCloud, type ReportStats, type WriterWeek } from './report/input';
import type { ReportCandidate } from './report/candidates';
import { writerState, navDates, needGb, freeGb, settledDay, type ReportView, type WriterView, type WriterState } from './report/view';

app.setName('Daylens');
app.setAppUserModelId('ai.worksight.daylens'); // matches the installer's shortcut, so the taskbar groups them
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
    db.exec(WEEKLY_SQL);
    const weeklyStore = createWeeklyStore(db);
    weeklyStore.clearPending(Date.now());
    db.exec(REPORT_FTS_SQL);
    const reportSearch = createReportSearch(db);
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
    // True for the lifetime of a live-tip writer.write call (set right before it, cleared when it itself
    // settles — not when the tip rewrite's own 20s race ends): two-way mutual exclusion with labelling/reports,
    // since a local write already in flight keeps its forked process alive past the 20s cap.
    let tipWriting = false;
    const scheduler = createLabelScheduler({
      store: labelStore, fork: forkBrain, modelReady: () => downloader.status().state === 'ready',
      modelDir, now: () => Date.now(), onChange: () => win?.webContents.send(CH.eventsUpdate),
      // Labelling, report writing and a live-tip rewrite must never run at the same time (all can be memory/CPU heavy).
      canStart: () => batchAllowed({
        freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: LAYA_NEED_BYTES
      }) && reportScheduler.running() === null && !tipWriting
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
    // `rewrite` (the AI-written tip dep) is filled in below, once the writer/report-scheduler/label-scheduler
    // pieces it needs all exist; coachDeps is the same object createCoach closes over, so assigning the field
    // later still takes effect (no forward-declare needed for those pieces).
    const coachDeps: CoachDeps = {
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
    };
    const coach = createCoach(coachDeps);
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
    // The live AI-tip rewrite (Phase 6b task 6): personalises a stuck_tip/repeat_search pop-up when the writer is
    // usable and idle, with a hard 20 s cap; any failure (unusable, busy, timeout, bad answer) keeps the template.
    // Titles pass the user's exclusion patterns (tipInput); the cloud never sees screen text. Never logs tip text.
    const TIP_REWRITE_TIMEOUT_MS = 20_000;
    coachDeps.rewrite = async (c, snap) => {
      const s = settings.get();
      const allowed = tipRewriteAllowed({
        mode: s.writerMode, installed: writerDl.status().state === 'ready', hasKey: secrets.has(s.aiProvider),
        unavailable: unavailable(), reportRunning: reportScheduler.running() !== null,
        labelling: scheduler.status().state === 'running', tipWriting,
        freeBytes: freemem(), needBytes: writerNeedBytes(writerTier())
      });
      if (!allowed) return c;
      const input = tipInput(c, snap, parseExclusions(s.exclusions));
      const { system, user } = tipPrompt(input);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        tipWriting = true;
        // Cleared when the write itself settles, not when the race below ends: a local write already forked
        // may keep running past the 20s cap, and labelling/reports must stay blocked until it actually finishes.
        const write = writer.write({ kind: 'tip', system, user, schema: TIP_JSON_SCHEMA, maxTokens: 160, parse: parseTip })
          .finally(() => { tipWriting = false; });
        const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIP_REWRITE_TIMEOUT_MS); });
        const res = await Promise.race([write, timeout]);
        if (!res || !res.ok) return c;
        const allowedMinutes = tipAllowedMinutes(input);
        const title = groundText(res.value.title, allowedMinutes);
        const body = groundText(res.value.body, allowedMinutes);
        return title && body ? { ...c, title, body } : c;
      } catch {
        return c;
      } finally {
        clearTimeout(timer);
      }
    };
    // Window titles + read labels only (never screen text), the final category as Today uses it.
    const detailFor = (date: string, now: number, reads = labelStore.readsForDay(date)): DayDetail => buildDayDetail({
      sessions: repo.getFocusSessions(date), now, exclusions: parseExclusions(settings.get().exclusions),
      reads: reads.map((r) => ({ at: r.at, appName: r.appName, activity: r.activity,
        category: r.category ? finalCategory(r.category, r.conf ?? 0, r.appName) : null }))
    });
    // A finished day's screen time and detail only change while its reads still wait for labels: cache them once the
    // day is settled (keyed with the exclusions, which shape the detail; cleared by Delete my activity) so the 7-day
    // memory and past-day views don't rebuild day views every time. Also holds what a week needs from the day view
    // (health score, per-category seconds) and the deep-work seconds (labelled episodes, no screen text).
    type PastDay = { screenSec: number; detail: DayDetail; deepWorkSec: number; healthScore: number | null; byCategory: Record<string, number> };
    const pastDays = new Map<string, PastDay>();
    const pastDay = (d: string): PastDay => {
      const key = `${d}\u0000${settings.get().exclusions}`;
      const hit = pastDays.get(key);
      if (hit) return hit;
      const { end } = dayBounds(d);
      const now = Math.min(Date.now(), end);
      const view = loadTodayView(repo, settings.get(), d, now, (l) => labelStore.labelsForDay(l), (l) => coachStore.completedBreaksForDay(l));
      const reads = labelStore.readsForDay(d);
      const v: PastDay = {
        screenSec: view.screenSec, detail: detailFor(d, now, reads), deepWorkSec: deepWorkSec(buildEpisodes(reads, false)),
        // A day with no screen time has no meaningful health score: leave it out of the week's average.
        healthScore: view.screenSec > 0 ? view.health.score : null,
        byCategory: Object.fromEntries(view.cards.map((c) => [c.category, c.seconds]))
      };
      if (d < localDate(Date.now()) && settledDay(end, labelStore.unlabelledSummary())) pastDays.set(key, v);
      return v;
    };
    // The writer's memory: the 7 days before `date`, with each day's stored headline when it has a ready report.
    const weekFor = (date: string): WriterWeek => buildWeek(Array.from({ length: 7 }, (_, i) => {
      const d = shiftDate(date, -(i + 1));
      const row = reportStore.get(d);
      return { date: d, ...pastDay(d), headline: row?.status === 'ready' ? row.report?.headline : undefined };
    }));
    const buildReportFor = (date: string) => {
      const s = settings.get();
      const { end } = dayBounds(date);
      const now = Math.min(Date.now(), end);
      const detail = date < localDate(Date.now()) ? pastDay(date).detail : detailFor(date, now);
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
      const input = buildReportInput({ stats, episodes, candidates, goals: { dailyGoalMin: s.dailyGoalMin, windDownTime: s.windDownTime, breakIntervalMin: s.breakIntervalMin },
        detail, week: weekFor(date) });
      return {
        input: cloud ? forCloud(input) : input,
        // Only ids the writer was actually shown (the input cap can drop candidates as a last resort).
        candidateIds: new Set(input.candidates.map((c) => c.id)), view, candidates, stats, detail
      };
    };
    // Top 5 app names for a day's search body: the cached detail for a finished day, the live one for today.
    const topAppsFor = (date: string): string[] => {
      const detail = date < localDate(Date.now()) ? pastDay(date).detail : detailFor(date, Math.min(Date.now(), dayBounds(date).end));
      return detail.apps.slice(0, 5).map((a) => a.app);
    };
    // --- Weekly insights: the week's numbers in code, and the writer input for the weekly summary ---
    const EMPTY_DETAIL: DayDetail = { apps: [], sites: [], videos: [], games: [], learning: [] };
    const zeroDay = (date: string): InsightsDay => ({ date, screenSec: 0, byCategory: {}, healthScore: null, deepWorkSec: 0 });
    // Days after today are empty; today itself is live (pastDay only caches finished days).
    const insightsDay = (d: string, today: string): { day: InsightsDay; detail: DayDetail } => {
      if (d > today) return { day: zeroDay(d), detail: EMPTY_DETAIL };
      const p = pastDay(d);
      return { day: { date: d, screenSec: p.screenSec, byCategory: p.byCategory, healthScore: p.healthScore, deepWorkSec: p.deepWorkSec }, detail: p.detail };
    };
    const weekData = (ws: string): { numbers: InsightsNumbers; input: WeekInput } => {
      const today = localDate(Date.now());
      const dates = weekDates(ws);
      const days = dates.map((d) => insightsDay(d, today));
      const prev = weekDates(shiftDate(ws, -7)).map((d) => insightsDay(d, today).day);
      const nudges = coachStore.since(dayBounds(ws).start).filter((n) => dates.includes(n.date));
      const numbers = buildInsights({
        weekStart: ws, days: days.map((x) => x.day), prevDays: prev.some((d) => d.screenSec > 0) ? prev : null, // no week to compare with
        apps: days.map((x) => x.detail.apps), nudges
      });
      // Window titles / app and site names only (never screen text); headlines only from ready daily reports
      // (generateWeek strips them for the cloud).
      const input = buildWeekInput(numbers, days.map(({ day, detail }) => {
        const row = reportStore.get(day.date);
        return { topApps: detail.apps.slice(0, 3).map((a) => a.app), topSites: detail.sites.slice(0, 3).map((s) => s.site),
          headline: row?.status === 'ready' ? row.report?.headline : undefined };
      }));
      return { numbers, input };
    };
    // Bumped by "Delete my activity": a report written across it must not be stored.
    let reportEpoch = 0;
    // Set by the fire-and-forget PDF auto-save after each ready report; read by reports.shareGet for the Settings warning.
    let pdfFolderError: string | null = null;
    const pdfRenderDeps = () => ({
      preload: join(__dirname, '../preload/index.js'),
      devUrl: process.env['ELECTRON_RENDERER_URL'],
      indexFile: join(__dirname, '../renderer/index.html')
    });
    // Serialises auto-saves so at most one hidden render window is ever open for them: every distinct
    // date scheduled still gets saved (e.g. yesterday's and today's reports both going ready while a
    // render is in flight), one at a time, in order; only a repeat schedule() for a date already
    // queued is coalesced. The folder is read fresh on each run.
    // reportEpoch as it was when the save was scheduled (scheduleAutoSave below); "Delete my activity" can bump
    // the epoch while a save still sits in the queue, and that report's data is gone by the time it would run.
    const pdfEpochAtSchedule = new Map<string, number>();
    const pdfQueue = createPdfQueue((date) => {
      const epoch = pdfEpochAtSchedule.get(date);
      pdfEpochAtSchedule.delete(date);
      if (epoch !== undefined && epoch !== reportEpoch) return Promise.resolve(); // deleted since this was scheduled: skip
      return autoSavePdf(date, settings.get().reportPdfFolder, {
        render: (d) => renderReportPdf(d, pdfRenderDeps()),
        write: writeFile,
        exists: (d) => stat(d).then((s) => s.isDirectory(), () => false),
        rename: (from, to) => rename(from, to),
        stillValid: () => epoch === undefined || epoch === reportEpoch, remove: (p) => unlink(p)
      }).then((r) => { pdfFolderError = r === 'ok' || r === 'off' || r === 'skipped' ? null : r; });
    });
    const scheduleAutoSave = (date: string): void => { pdfEpochAtSchedule.set(date, reportEpoch); pdfQueue.schedule(date); };
    // Set when the PC sleeps mid-write: that write's timeout / crash is the sleep's fault, not the writer's.
    let suspendedDuringWrite = false;
    const pastActivity = new Map<string, boolean>(); // date → ≥30 min screen time, for finished days only (cleared by Delete my activity)
    // A day with real screen time, not just a stray focus session (see MIN_AUTO_SCREEN_SEC). Today is always live.
    const activeDay = (d: string): boolean => {
      const past = d < localDate(Date.now());
      if (past && pastActivity.has(d)) return pastActivity.get(d) as boolean; // a finished day's screen time can't change
      const { end } = dayBounds(d);
      const now = Math.min(Date.now(), end);
      const ok = loadTodayView(repo, settings.get(), d, now, (l) => labelStore.labelsForDay(l), (l) => coachStore.completedBreaksForDay(l)).screenSec >= MIN_AUTO_SCREEN_SEC;
      if (past) pastActivity.set(d, ok);
      return ok;
    };
    reportScheduler = createReportScheduler({
      now: () => Date.now(),
      windDown: (d) => planOverrides(reportStore.plan(d), d).windDownTime ?? settings.get().windDownTime,
      row: (d) => reportStore.get(d),
      hasActivity: activeDay,
      // Checked after the daily reports. Active days use the same ≥ 30 min rule (cached for finished days, live today).
      weekDue: () => {
        const today = localDate(Date.now());
        return weekDueKey({
          today, hasWeekly: (ws) => weeklyStore.get(ws) !== null,
          activeDays: (ws) => weekDates(ws).filter((d) => d <= today && activeDay(d)).length,
          sundayReady: (ws) => reportStore.get(weekDates(ws)[6])?.status === 'ready'
        });
      },
      canWrite: () => writerUsable({ mode: settings.get().writerMode, installed: writerDl.status().state === 'ready', hasKey: secrets.has(settings.get().aiProvider), unavailable: unavailable() }),
      gateOk: () => settings.get().writerMode === 'cloud' || batchAllowed({
        freeBytes: freemem(), idleSec: powerMonitor.getSystemIdleTime(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked', needBytes: writerNeedBytes(writerTier())
      }),
      // A click runs as soon as there's enough free memory; it doesn't wait for idle.
      manualGateOk: () => settings.get().writerMode === 'cloud' || freemem() >= writerNeedBytes(writerTier()),
      otherJobRunning: () => scheduler.status().state === 'running' || tipWriting,
      lowBattery: async () => powerMonitor.isOnBatteryPower() && ((await batteryPercent()) ?? 100) < 20,
      // `key` is a date (daily report) or `W:<weekStart>` (weekly summary): one writer job at a time either way.
      generate: async (key) => {
        const week = key.startsWith('W:') ? key.slice(2) : null;
        const date = key;
        suspendedDuringWrite = false;
        const outcome = week
          ? await generateWeek(week, { build: (ws) => ({ input: weekData(ws).input }), writer, store: weeklyStore, now: () => Date.now(),
            epoch: () => reportEpoch, cloud: () => settings.get().writerMode === 'cloud' })
          : await generateReport(date, { build: buildReportFor, writer, store: reportStore, now: () => Date.now(), epoch: () => reportEpoch });
        const slept = suspendedDuringWrite;
        suspendedDuringWrite = false;
        if (slept && (outcome === 'timeout' || outcome === 'crash')) {
          // Not counted (no crash, no timeout). Drop the failed row so the automatic rule writes it again later;
          // a kept good report (failed regenerate) stays.
          if (week) { if (weeklyStore.get(week)?.status !== 'ready') weeklyStore.delete(week); }
          else if (reportStore.get(date)?.status !== 'ready') reportStore.delete(date);
          return 'failed';
        }
        if (outcome === 'crash') pushCrash();
        if (outcome === 'load') writerHealth.loadFailed = true;
        writerHealth.consecutiveTimeouts = outcome === 'timeout' ? writerHealth.consecutiveTimeouts + 1 : outcome === 'ok' ? 0 : writerHealth.consecutiveTimeouts;
        // Search indexing and the PDF auto-save are for daily reports only.
        if (outcome === 'ok' && !week) {
          try {
            const fresh = reportStore.get(date);
            if (fresh?.status === 'ready' && fresh.report) reportSearch.upsert(date, reportBody(fresh.report, topAppsFor(date)));
          } catch (e) { console.error('[search] upsert failed:', e); }
          // Fire-and-forget: never delay the scheduler on the PDF write; failures only surface as a Settings warning.
          scheduleAutoSave(date);
        }
        return outcome;
      },
      onChange: () => win?.webContents.send(CH.eventsUpdate)
    });
    setInterval(() => { void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e)); }, 60_000);
    const currentWriterState = (): WriterState => {
      const s = settings.get();
      return writerState({ mode: s.writerMode, hasKey: secrets.has(s.aiProvider), cloudModel: s.aiModel, tier: writerTier(), model: writerDl.status(), unavailable: unavailable() });
    };
    const reportView = (date: string | null): ReportView => {
      refreshFreeDisk();
      const rows = reportStore.dates();
      const today = localDate(Date.now());
      const d = date ?? rows[0] ?? today;
      const row = reportStore.get(d);
      let stats: ReportStats | null = null;
      let timeline: TimelineSegment[] = [];
      let candidates: ReportCandidate[] = [];
      let detail: DayDetail = { apps: [], sites: [], videos: [], games: [], learning: [] };
      try {
        const built = buildReportFor(d);
        stats = built.stats;
        timeline = built.view.timeline;
        candidates = built.candidates;
        detail = built.detail;
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
        writer: currentWriterState(),
        waiting: reportScheduler.waiting() === d, running: reportScheduler.running() === d, autoPaused: reportScheduler.autoPaused(),
        needGb: needGb(writerTier()), freeGb: freeGb(freemem()), queued: reportScheduler.queued(d), cancellable: reportScheduler.requested(d),
        memoryShort: s.writerMode === 'local' && freemem() < writerNeedBytes(writerTier()), detail
      };
    };
    // `req` may be any date in the week (null = this week); a future week shows the current one.
    const insightsView = (req: string | null): InsightsView => {
      refreshFreeDisk();
      const current = weekStart(localDate(Date.now()));
      const asked = req ? weekStart(req) : current;
      const ws = asked > current ? current : asked;
      let numbers: InsightsNumbers;
      try { numbers = weekData(ws).numbers; } catch (e) {
        console.error('[insights] view build failed:', e);
        numbers = buildInsights({ weekStart: ws, days: weekDates(ws).map(zeroDay), prevDays: null, apps: [], nudges: [] });
      }
      const days = repo.getAvailableDays(); // newest first
      const oldest = days.length ? days[days.length - 1] : null;
      const row = weeklyStore.get(ws);
      const key = `W:${ws}`;
      const s = settings.get();
      return {
        numbers, weekStart: ws,
        prevWeek: oldest !== null && weekStart(oldest) < ws ? shiftDate(ws, -7) : null,
        nextWeek: ws < current ? shiftDate(ws, 7) : null,
        // Never show a raw `load: <path>` error (same rule as reportView).
        row: row?.error?.startsWith('load:') ? { ...row, error: friendlyReason(row.error, 'week') } : row,
        writer: currentWriterState(),
        waiting: reportScheduler.waiting() === key, running: reportScheduler.running() === key, autoPaused: reportScheduler.autoPaused(),
        needGb: needGb(writerTier()), freeGb: freeGb(freemem()), queued: reportScheduler.queued(key), cancellable: reportScheduler.requested(key),
        memoryShort: s.writerMode === 'local' && freemem() < writerNeedBytes(writerTier())
      };
    };
    // Also refreshes free disk for download / retryLocal, which both answer with writerView().
    const writerView = (): WriterView => {
      refreshFreeDisk();
      const s = settings.get();
      return {
        state: currentWriterState(),
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
        // Days with tracked activity, newest first, for the date picker.
        days: () => repo.getAvailableDays().slice(0, 365),
        generate: (date) => {
          const today = localDate(Date.now());
          // Future dates and a date already being written are both no-ops: just report the current view.
          if (date > today || reportScheduler.running() === date) return reportView(date);
          reportScheduler.request(date);
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e));
          return reportView(date);
        },
        cancel: (date) => {
          reportScheduler.cancel(date);
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e)); // the next queued day, if any
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
            render: (d) => renderReportPdf(d, pdfRenderDeps()),
            write: (p, b) => writeFile(p, b)
          }, filePath);
          return r === 'ok' ? { ok: true, path: filePath } : { ok: false, reason: r };
        },
        search: (q) => reportSearch.search(q),
        choosePdfFolder: async () => {
          const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
          if (r.canceled || !r.filePaths[0]) return { folder: settings.get().reportPdfFolder };
          settings.set({ reportPdfFolder: r.filePaths[0] });
          pdfFolderError = null; // a fresh folder choice clears any warning from the old one
          return { folder: r.filePaths[0] };
        },
        clearPdfFolder: () => { settings.set({ reportPdfFolder: '' }); pdfFolderError = null; return { folder: '' }; },
        shareGet: async () => {
          // A save-time failure (pdfFolderError) always wins: it's more specific than a plain "gone" check.
          const folder = settings.get().reportPdfFolder;
          if (!pdfFolderError && folder && (await checkFolder(folder, stat)) === 'missing') return { folder, lastError: "The auto-save folder can't be found." };
          return { folder, lastError: pdfFolderError };
        },
        email: async (date) => {
          const folder = settings.get().reportPdfFolder;
          const saved = folder ? autoSavePath(folder, date) : null;
          let pdf: string;
          try {
            const savedExists = saved !== null && await stat(saved).then((s) => s.isFile(), () => false);
            pdf = savedExists && saved ? saved : join(app.getPath('temp'), pdfFileName(date));
            if (!savedExists) {
              const r = await exportPdf(date, { render: (d) => renderReportPdf(d, pdfRenderDeps()), write: (p, b) => writeFile(p, b) }, pdf);
              if (r !== 'ok') throw new Error(r);
            }
          } catch (e) {
            // Never surface the raw error (it can include a filesystem path); log only its type.
            console.error('[report] email PDF prep failed:', e instanceof Error ? e.name : typeof e);
            return { ok: false, reason: "Couldn't prepare the PDF for email." };
          }
          try {
            await shell.openExternal(mailtoUrl(date, reportStore.get(date)?.report ?? null));
            shell.showItemInFolder(pdf);
            return { ok: true };
          } catch (e) {
            console.error('[report] email open failed:', e instanceof Error ? e.name : typeof e);
            return { ok: false, reason: "Couldn't open your mail app." };
          }
        }
      },
      insights: {
        view: (ws) => insightsView(ws),
        generate: (req) => {
          const ws = weekStart(req);
          const key = `W:${ws}`;
          const today = localDate(Date.now());
          const days = repo.getAvailableDays(); // newest first
          const oldest = days.length ? days[days.length - 1] : null;
          if (oldest === null || shiftDate(ws, 6) < oldest) return insightsView(ws); // nothing tracked that week
          // A future week, the current week before its own Sunday, and a week already being written are all no-ops:
          // just report the current view (the renderer hides the button in the first two cases; this backs it up).
          if (ws > weekStart(today) || !canGenerateWeek(ws, today) || reportScheduler.running() === key) return insightsView(ws);
          reportScheduler.request(key);
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e));
          return insightsView(ws);
        },
        cancel: (req) => {
          reportScheduler.cancel(`W:${weekStart(req)}`);
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e)); // the next queued job, if any
          return insightsView(req);
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
        // Aborts and keeps the .part file so a later Download resumes; the downloader's own
        // stopImpl() sets status to 'missing', which countsAsFailure() never treats as a failure.
        cancelDownload: () => { writerDl.stop(); return writerView(); },
        remove: async () => {
          // Never delete the local model out from under a report or a tip rewrite actively being written with it.
          if (settings.get().writerMode === 'local' && (reportScheduler.running() !== null || tipWriting)) return writerView();
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
          // A write queued for memory can go to the cloud now, not at the next 60 s tick.
          void reportScheduler.tick().catch((e) => console.error('[report] tick failed:', e));
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
      about: () => ({ version: app.getVersion(), credits: [WRITER_ATTRIBUTION] }),
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
            detail: "Screen time, app history, screen reads, daily reports, weekly summaries and plan items will be erased from this PC. Your settings and answers are kept. This can't be undone."
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
            pastActivity.clear();
            pastDays.clear();
            deleteActivity(db);
            pill.dismissAll(); // any on-screen nudges reference rows that just got wiped
            try { checkpoint(db); } catch (e) { console.error('[privacy] checkpoint after delete failed:', e); } // the delete itself succeeded
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

    // Index every ready report search doesn't already have (e.g. after an upgrade, or one written before search
    // existed). Deferred with setImmediate until after createWindow(), and per-date try/catch: rebuilding a day
    // view for every ready report must not delay the window opening, and one bad row must not stop the rest from
    // being indexed; the log names only the date, never the error (which could otherwise echo report text into it).
    setImmediate(() => {
      const already = reportSearch.indexedDates();
      for (const d of reportStore.dates()) {
        if (already.has(d)) continue;
        try {
          const row = reportStore.get(d);
          if (row?.status === 'ready' && row.report) reportSearch.upsert(d, reportBody(row.report, topAppsFor(d)));
        } catch { console.error('[search] backfill failed for', d); }
      }
    });

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
