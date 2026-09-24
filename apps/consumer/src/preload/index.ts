import { contextBridge, ipcRenderer } from 'electron';
import type { TrackingStatus } from '@worksight/core/types';
import { CH } from '../main/channels';
import type { DaylensSettings, SettingsPatch } from '../main/settings';
import type { TodayView } from '../main/day/today';
import type { Profile } from '../shared/profileOptions';

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
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  }
};

export type DaylensApi = typeof api;
contextBridge.exposeInMainWorld('daylens', api);
