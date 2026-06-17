import { app, BrowserWindow, Tray, Menu, powerMonitor, safeStorage } from 'electron';
import { join } from 'node:path';
import { openDatabase } from './db/database';
import { createRepositories } from './db/repositories';
import { createSettingsStore } from './settings';
import { createTracker } from './tracking/tracker';
import { systemClock } from './tracking/types';
import { ActiveWinForegroundSource } from './tracking/activeWindow';
import { UiohookInputSource } from './tracking/inputActivity';
import { registerIpc } from './ipc/handlers';
import { CH } from './ipc/channels';
import { getCloudConfig } from './cloud/config';
import { upsertDailyActivity } from './cloud/client';
import { createSessionManager } from './cloud/session';
import { createCloudController } from './cloud/controller';

// Filesystem-safe app name so userData (the SQLite location) is not under a scoped "@worksight/agent" path.
app.setName('WorkSight Agent');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100, height: 760, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.on('ready-to-show', () => win?.show());
  win.on('close', (e) => { if (!(app as unknown as { isQuitting?: boolean }).isQuitting) { e.preventDefault(); win?.hide(); } });
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'worksight.sqlite'));
  const repo = createRepositories(db);
  const enc = {
    encrypt: (s: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'),
    decrypt: (b: Buffer) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')
  };
  const settings = createSettingsStore(db, enc);

  const cloudConfig = getCloudConfig();
  const sessionManager = createSessionManager({
    fetchFn: fetch, config: cloudConfig,
    store: { get: () => settings.getCloudSession(), set: (s) => settings.setCloudSession(s) },
    now: () => Date.now()
  });
  const cloud = createCloudController({
    session: sessionManager, settings,
    repo: { getFocusSessions: (d) => repo.getFocusSessions(d), getActivitySamples: (d) => repo.getActivitySamples(d) },
    upsert: (token, rows) => upsertDailyActivity(fetch, cloudConfig, token, rows),
    now: () => Date.now()
  });

  const pushUpdate = (): void => win?.webContents.send(CH.eventsUpdate);
  const tracker = createTracker({
    foreground: new ActiveWinForegroundSource(),
    input: new UiohookInputSource(),
    clock: systemClock,
    repo,
    getSettings: () => settings.get(),
    getSystemIdleSec: () => powerMonitor.getSystemIdleTime(),
    onUpdate: pushUpdate
  });

  registerIpc({ repo, settings, tracker, cloud, onTrackingChange: pushUpdate });

  createWindow();

  // Start tracking BEFORE building the tray: a tray/icon failure must never prevent tracking.
  const s = settings.get();
  if (s.consentGranted && !s.trackingPaused) tracker.start();

  try {
    // In the packaged app the icon ships via extraResources at process.resourcesPath;
    // unpackaged/dev it sits next to out/ in the source resources folder.
    const trayIcon = app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png');
    tray = new Tray(trayIcon);
    const refreshTrayMenu = (): void => {
      const paused = settings.get().trackingPaused;
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open WorkSight', click: () => { if (!win) createWindow(); win?.show(); } },
        { label: paused ? 'Resume tracking' : 'Pause tracking', click: () => { paused ? tracker.start() : tracker.stop(); settings.set({ trackingPaused: !paused }); refreshTrayMenu(); pushUpdate(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; app.quit(); } }
      ]));
    };
    refreshTrayMenu();
    tray.setToolTip('WorkSight Agent');
  } catch (e) {
    console.error('[main] tray setup failed (continuing, tracking unaffected):', e);
  }

  const cloudTimer = setInterval(() => { void cloud.maybeAutoSync(); }, 15 * 60 * 1000);
  app.on('before-quit', () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; tracker.stop(); });
  let cloudQuitFlushed = false;
  app.on('before-quit', (e) => {
    clearInterval(cloudTimer);
    if (cloudQuitFlushed) return;
    const s = settings.get();
    if (!s.cloudSyncEnabled || !cloud.getStatus().connected) return; // nothing to flush; let quit proceed
    e.preventDefault();
    cloudQuitFlushed = true;
    Promise.race([cloud.maybeAutoSync(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { /* intentionally do not quit */ });
