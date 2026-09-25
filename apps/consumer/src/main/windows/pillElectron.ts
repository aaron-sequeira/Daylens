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
  // A page that fails to load, or whose renderer crashes, leaves a blank window that
  // will never fire 'did-finish-load' again. Destroy it so isDestroyed() reflects
  // reality and the manager creates a fresh one on the next show().
  w.webContents.on('did-fail-load', () => { if (!w.isDestroyed()) w.destroy(); });
  w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.destroy(); });
  load(w);
  return {
    send: (c, p) => { if (!w.isDestroyed()) w.webContents.send(c, p); },
    setIgnoreMouseEvents: (ignore) => { if (!w.isDestroyed()) w.setIgnoreMouseEvents(ignore, { forward: true }); },
    showInactive: () => w.showInactive(),
    // setBounds (not setPosition) so the OS doesn't apply its own DPI-driven resize
    // when the window is created on, or moved across, a different-DPI monitor.
    setPosition: (x, y) => { if (!w.isDestroyed()) w.setBounds({ x: Math.round(x), y: Math.round(y), width: PILL_W, height: PILL_H }); },
    destroy: () => { if (!w.isDestroyed()) w.destroy(); },
    isDestroyed: () => w.isDestroyed(),
    onReady: (cb) => { w.webContents.once('did-finish-load', cb); }
  };
}
