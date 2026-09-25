import { contextBridge, ipcRenderer } from 'electron';
import type { TrackingStatus } from '@worksight/core/types';
import { CH } from '../main/channels';
import type { DaylensSettings, SettingsPatch } from '../main/settings';
import type { TodayView } from '../main/day/today';
import type { Profile } from '../shared/profileOptions';
import type { PrivacyView, ModelsView, CoachView } from '../main/ipc';

const api = {
  today: (date: string): Promise<TodayView> => ipcRenderer.invoke(CH.todayGet, { date }),
  settings: {
    get: (): Promise<DaylensSettings> => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: SettingsPatch): Promise<DaylensSettings> => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  consent: { grant: (): Promise<DaylensSettings> => ipcRenderer.invoke(CH.consentGrant) },
  profile: {
    get: (): Promise<Profile> => ipcRenderer.invoke(CH.profileGet),
    save: (p: Profile): Promise<DaylensSettings> => ipcRenderer.invoke(CH.profileSave, p)
  },
  tracking: {
    status: (): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingStatus),
    set: (on: boolean): Promise<TrackingStatus> => ipcRenderer.invoke(CH.trackingSet, on)
  },
  privacy: {
    get: (): Promise<PrivacyView> => ipcRenderer.invoke(CH.privacyGet),
    setExclusions: (list: string[]): Promise<PrivacyView> => ipcRenderer.invoke(CH.privacySetExclusions, list),
    export: (): Promise<{ saved: boolean; path?: string }> => ipcRenderer.invoke(CH.privacyExport),
    deleteActivity: (): Promise<{ deleted: boolean }> => ipcRenderer.invoke(CH.privacyDeleteActivity),
    openLanguageSettings: (): Promise<void> => ipcRenderer.invoke(CH.privacyOpenLanguageSettings)
  },
  models: {
    get: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsGet),
    redownload: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsRedownload),
    delete: (): Promise<{ deleted: boolean }> => ipcRenderer.invoke(CH.modelsDelete),
    retryLabelling: (): Promise<ModelsView> => ipcRenderer.invoke(CH.modelsRetryLabelling)
  },
  coach: {
    get: (): Promise<CoachView> => ipcRenderer.invoke(CH.coachGet),
    setKinds: (k: Record<'health' | 'behaviour' | 'tip' | 'win', boolean>): Promise<CoachView> => ipcRenderer.invoke(CH.coachSetKinds, k),
    snooze: (v: '1h' | 'tomorrow' | 'off'): Promise<CoachView> => ipcRenderer.invoke(CH.coachSnooze, v),
    setLimits: (l: { app: string; minutes: number }[]): Promise<CoachView> => ipcRenderer.invoke(CH.coachSetLimits, l),
    dismissHeld: (id: number): Promise<CoachView> => ipcRenderer.invoke(CH.coachDismissHeld, id),
    test: (): Promise<void> => ipcRenderer.invoke(CH.coachTest)
  },
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  }
};

export type DaylensApi = typeof api;
contextBridge.exposeInMainWorld('daylens', api);
