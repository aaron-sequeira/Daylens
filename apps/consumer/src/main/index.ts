import { app, BrowserWindow, Menu, Tray, powerMonitor, dialog, shell } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createKvStore, createRepositories, createTracker, openDatabase, systemClock } from '@worksight/core';
import { ActiveWinForegroundSource, UiohookInputSource } from '@worksight/core/adapters';
import { localDate } from '@worksight/core/date';
import { CH } from './channels';
import { registerIpc } from './ipc';
import { DEFAULT_SETTINGS } from './settings';
import { createOcrClient } from './ocr/client';
import { SCREEN_SCHEMA, createScreenStore, checkpoint, deleteActivity, exportAll } from './screen/store';
import { createScreenReader, runRetention } from './screen/reader';
import { readProfile } from './profile';

app.setName('Daylens');
const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let stopTracking = (): void => {}; // set once the tracker exists

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
    // ponytail: dev path; Phase 7 packaging must ship resources/ocr-helper.ps1 via extraResources.
    const helperPath = app.isPackaged ? join(process.resourcesPath, 'ocr-helper.ps1') : join(__dirname, '../../resources/ocr-helper.ps1');
    const ocr = createOcrClient({
      // stderr is ignored, not piped: an undrained stderr pipe can fill up and block the helper.
      spawn: () => spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }),
      onStatus: () => win?.webContents.send(CH.eventsUpdate)
    });

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
      selfPid: process.pid
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
      onSettingsChanged: () => { applyLoginItem(); syncOcr(); retention(); },
      now: () => Date.now(),
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
            detail: "Screen time, app history and screen reads will be erased from this PC. Your settings and answers are kept. This can't be undone."
          });
          if (r.response !== 0) return { deleted: false };
          const s = settings.get();
          const wasRunning = s.consentGranted && !s.trackingPaused;
          tracker.stop();
          ocr.stop();
          // A failed delete must not leave tracking/OCR silently off: restart them (and re-sync OCR)
          // whether deleteActivity succeeds or throws.
          try {
            deleteActivity(db);
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

    // Start tracking BEFORE the tray: a tray failure must never prevent tracking.
    const s = settings.get();
    if (s.consentGranted && !s.trackingPaused) tracker.start();
    applyLoginItem();
    syncOcr();
    retention();

    try {
      tray = new Tray(app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png'));
      tray.setToolTip('Daylens');
      tray.on('click', showWindow);
      refreshTray();
    } catch (e) {
      console.error('[main] tray setup failed (tracking unaffected):', e);
    }

    app.on('before-quit', () => { quitting = true; tracker.stop(); ocr.stop(); });
    // Sleep must not count as screen time: stop (closes the session, flushes the bucket) before suspend and
    // restart on wake. tracker.stop() is idempotent, so suspending while paused writes nothing.
    powerMonitor.on('suspend', () => tracker.stop());
    powerMonitor.on('resume', () => {
      const cur = settings.get();
      if (cur.consentGranted && !cur.trackingPaused) tracker.start();
    });
  });
}

app.on('window-all-closed', () => { /* keep running in the tray */ });
