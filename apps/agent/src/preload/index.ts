import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../main/ipc/channels';
import type { AppSettings, DaySummary, TrackingStatus, AiSummaryResult, AiSummaryError, CloudSyncStatus } from '../shared/types';

const api = {
  tracking: {
    getStatus: (): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingGetStatus),
    pause: (): Promise<void> => ipcRenderer.invoke(CH.trackingPause),
    resume: (): Promise<void> => ipcRenderer.invoke(CH.trackingResume)
  },
  summary: {
    getDay: (date: string): Promise<DaySummary> => ipcRenderer.invoke(CH.summaryGetDay, { date }),
    getAvailableDays: (): Promise<string[]> => ipcRenderer.invoke(CH.summaryGetDays),
    generateAi: (date: string): Promise<AiSummaryResult | AiSummaryError> => ipcRenderer.invoke(CH.summaryGenerateAi, { date })
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsSet, patch),
    setApiKey: (key: string): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsSetApiKey, key)
  },
  data: { clearAll: (): Promise<void> => ipcRenderer.invoke(CH.dataClearAll) },
  cloud: {
    getStatus: (): Promise<CloudSyncStatus> => ipcRenderer.invoke(CH.cloudGetStatus),
    signIn: (email: string, password: string): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke(CH.cloudSignIn, { email, password }),
    signOut: (): Promise<void> => ipcRenderer.invoke(CH.cloudSignOut),
    setEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke(CH.cloudSetEnabled, enabled),
    syncNow: (): Promise<{ syncedDays: number } | { error: string }> => ipcRenderer.invoke(CH.cloudSyncNow)
  },
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  }
};

export type WorkSightApi = typeof api;
contextBridge.exposeInMainWorld('worksight', api);
