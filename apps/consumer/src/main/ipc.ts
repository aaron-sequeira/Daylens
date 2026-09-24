import { ipcMain } from 'electron';
import { z } from 'zod';
import type { KvStore, Repositories, Tracker } from '@worksight/core';
import { CH } from './channels';
import { settingsPatch, type DaylensSettings } from './settings';
import { loadTodayView } from './day/today';

const dateArg = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export interface IpcDeps {
  repo: Repositories;
  settings: KvStore<DaylensSettings>;
  tracker: Tracker;
  setTracking(on: boolean): void;
  onSettingsChanged(): void;
  now(): number;
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(CH.todayGet, (_e, raw) => loadTodayView(d.repo, d.settings.get(), dateArg.parse(raw).date, d.now()));
  ipcMain.handle(CH.settingsGet, () => d.settings.get());
  ipcMain.handle(CH.settingsSet, (_e, raw) => {
    const next = d.settings.set(settingsPatch.parse(raw));
    d.onSettingsChanged();
    return next;
  });
  ipcMain.handle(CH.consentGrant, () => {
    d.settings.set({ consentGranted: true });
    if (!d.settings.get().trackingPaused) d.tracker.start();
    return d.settings.get();
  });
  ipcMain.handle(CH.trackingStatus, () => d.tracker.status());
  ipcMain.handle(CH.trackingSet, (_e, raw) => { d.setTracking(z.boolean().parse(raw)); return d.tracker.status(); });
}
