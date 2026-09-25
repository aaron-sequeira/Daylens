import { BrowserWindow, ipcMain } from 'electron';
import { PILL_H, PILL_W, type PillWindowLike } from './pill';

/** Real Electron window for the pill (never focusable: it must not steal typing). */
export function electronPillWindow(preload: string, load: (w: BrowserWindow) => void, onMessage: (raw: unknown) => void): PillWindowLike {
  const w = new BrowserWindow({
    width: PILL_W, height: PILL_H, frame: false, transparent: true, focusable: false, skipTaskbar: true, resizable: false,
    hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  const listener = (e: Electron.IpcMainEvent, raw: unknown): void => { if (e.sender === w.webContents) onMessage(raw); };
  ipcMain.on('pill:msg', listener);
  w.on('closed', () => ipcMain.off('pill:msg', listener));
  load(w);
  return {
    send: (c, p) => { if (!w.isDestroyed()) w.webContents.send(c, p); },
    setIgnoreMouseEvents: (ignore) => { if (!w.isDestroyed()) w.setIgnoreMouseEvents(ignore, { forward: true }); },
    showInactive: () => w.showInactive(),
    setPosition: (x, y) => w.setPosition(Math.round(x), Math.round(y)),
    destroy: () => { if (!w.isDestroyed()) w.destroy(); },
    isDestroyed: () => w.isDestroyed(),
    onReady: (cb) => { w.webContents.once('did-finish-load', cb); }
  };
}
