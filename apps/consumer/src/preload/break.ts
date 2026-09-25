import { contextBridge, ipcRenderer } from 'electron';

const api = {
  onStart: (cb: (p: { kind: 'eye' | 'stretch'; seconds: number }) => void): void => { ipcRenderer.on('break:start', (_e, p) => cb(p)); },
  onExtend: (cb: () => void): void => { ipcRenderer.on('break:extend', () => cb()); },
  extend: (): void => ipcRenderer.send('break:msg', { type: 'extend' }),
  done: (r: { completed: boolean; seconds: number }): void => ipcRenderer.send('break:msg', { type: 'done', ...r })
};
export type BreakApi = typeof api;
contextBridge.exposeInMainWorld('brk', api);
