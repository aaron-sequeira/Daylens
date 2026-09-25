import { contextBridge, ipcRenderer } from 'electron';
import type { PillAction, PillNudge } from '../main/coach/types';

const api = {
  onShow: (cb: (n: PillNudge) => void): void => { ipcRenderer.on('pill:show', (_e, n: PillNudge) => cb(n)); },
  onDismissAll: (cb: () => void): void => { ipcRenderer.on('pill:dismissAll', () => cb()); },
  hover: (hover: boolean): void => ipcRenderer.send('pill:msg', { type: 'hover', hover }),
  action: (id: number, action: PillAction): void => ipcRenderer.send('pill:msg', { type: 'action', id, action }),
  empty: (): void => ipcRenderer.send('pill:msg', { type: 'empty' })
};
export type PillApi = typeof api;
contextBridge.exposeInMainWorld('pill', api);
