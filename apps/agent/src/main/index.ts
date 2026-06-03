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

  registerIpc({ repo, settings, tracker, onTrackingChange: pushUpdate });

  createWindow();

  tray = new Tray(join(__dirname, '../../resources/tray.png'));
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

  const s = settings.get();
  if (s.consentGranted && !s.trackingPaused) tracker.start();

  app.on('before-quit', () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; tracker.stop(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { /* intentionally do not quit */ });
