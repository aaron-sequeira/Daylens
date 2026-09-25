import { BrowserWindow, ipcMain } from 'electron';
import { release } from 'node:os';
import type { Rect } from '../coach/gate';
import type { BreakWindowLike } from './breakOverlay';

const acrylic = (): boolean => process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621;

/** Real Electron window for one display's break overlay: full-screen and always-on-top.
 * See `onGone` for how the manager ends the break instead of leaving the user stuck
 * behind an overlay whose window has crashed, failed to load, or been closed directly. */
export function electronBreakWindow(bounds: Rect, preload: string, load: (w: BrowserWindow) => void, onMessage: (raw: unknown) => void): BreakWindowLike {
  const glass = acrylic();
  const w = new BrowserWindow({
    ...bounds, frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: glass ? '#00000000' : '#FBF8F4E6', ...(glass ? { backgroundMaterial: 'acrylic' as const } : { transparent: true }),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  // Same mixed-DPI workaround as pillElectron.ts's setPosition: setBounds (not relying on the
  // constructor options alone) so the OS doesn't apply its own DPI-driven resize when the
  // window is created on, or would otherwise be placed across, a different-DPI monitor.
  w.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
  w.setAlwaysOnTop(true, 'screen-saver');
  const listener = (e: Electron.IpcMainEvent, raw: unknown): void => { if (e.sender === w.webContents) onMessage(raw); };
  ipcMain.on('break:msg', listener);
  w.on('closed', () => ipcMain.off('break:msg', listener));

  let goneCb: (() => void) | null = null;
  // True once the manager closed this window itself, or `onGone` already fired once —
  // guards against firing `onGone` twice (e.g. destroy() after a failed load also emits 'closed').
  let settled = false;
  const fireGone = (): void => { if (settled) return; settled = true; goneCb?.(); };

  w.webContents.on('did-fail-load', () => { fireGone(); if (!w.isDestroyed()) w.destroy(); });
  w.webContents.on('render-process-gone', () => { fireGone(); if (!w.isDestroyed()) w.destroy(); });
  // Covers the user closing the overlay directly (e.g. Alt+F4): `close()` below marks
  // `settled` first, so a manager-initiated close does not also report as "gone".
  w.on('closed', () => fireGone());

  load(w);
  return {
    send: (c, p) => { if (!w.isDestroyed()) w.webContents.send(c, p); },
    close: () => { settled = true; if (!w.isDestroyed()) w.close(); },
    onReady: (cb) => { w.webContents.once('did-finish-load', () => { w.showInactive(); cb(); }); },
    focus: () => { if (!w.isDestroyed()) { w.show(); w.focus(); } },
    onGone: (cb) => { goneCb = cb; }
  };
}
