import { app, BrowserWindow, Menu, Tray, powerMonitor } from 'electron';
import { join } from 'node:path';
import { createKvStore, createRepositories, createTracker, openDatabase, systemClock } from '@worksight/core';
import { ActiveWinForegroundSource, UiohookInputSource } from '@worksight/core/adapters';
import { CH } from './channels';
import { registerIpc } from './ipc';
import { DEFAULT_SETTINGS } from './settings';

app.setName('Daylens');
const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1100, minHeight: 720, show: false, backgroundColor: '#FBF8F4',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#FBF8F4', symbolColor: '#171717', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => { if (!startHidden) win?.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
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
    const repo = createRepositories(db);
    const settings = createKvStore(db, DEFAULT_SETTINGS);

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
      win?.webContents.send(CH.eventsUpdate);
    }
    const applyLoginItem = (): void => {
      // Only the packaged app registers itself; in dev this would register electron.exe.
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, args: ['--hidden'] });
    };

    registerIpc({ repo, settings, tracker, setTracking, onSettingsChanged: applyLoginItem, now: () => Date.now() });
    createWindow();

    // Start tracking BEFORE the tray: a tray failure must never prevent tracking.
    const s = settings.get();
    if (s.consentGranted && !s.trackingPaused) tracker.start();
    applyLoginItem();

    try {
      tray = new Tray(app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png'));
      tray.setToolTip('Daylens');
      tray.on('click', showWindow);
      refreshTray();
    } catch (e) {
      console.error('[main] tray setup failed (tracking unaffected):', e);
    }

    app.on('before-quit', () => { quitting = true; tracker.stop(); });
  });
}

app.on('window-all-closed', () => { /* keep running in the tray */ });
