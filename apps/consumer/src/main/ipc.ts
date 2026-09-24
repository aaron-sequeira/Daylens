import { ipcMain } from 'electron';
import { z } from 'zod';
import type { KvStore, Repositories, Tracker } from '@worksight/core';
import { CH } from './channels';
import { settingsPatch, type DaylensSettings } from './settings';
import { profileInput, readProfile, toSettingsPatch } from './profile';
import { loadTodayView } from './day/today';
import type { OcrStatus } from './ocr/client';
import type { ScreenReadRow } from './screen/store';
import { exclusionsInput, parseExclusions } from './screen/exclusions';

const dateArg = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export interface PrivacyView {
  screenReading: boolean;
  retentionDays: number;
  exclusions: string[];
  ocrStatus: OcrStatus;
  lastRead: { at: number; app: string; title: string | null; text: string } | null;
}

export interface PrivacyDeps {
  ocrStatus(): OcrStatus;
  lastRead(): ScreenReadRow | null;
  exportData(): Promise<{ saved: boolean; path?: string }>;
  deleteActivity(): Promise<{ deleted: boolean }>;
  openLanguageSettings(): void;
}

export interface IpcDeps {
  repo: Repositories;
  settings: KvStore<DaylensSettings>;
  tracker: Tracker;
  setTracking(on: boolean): void;
  onSettingsChanged(): void;
  now(): number;
  privacy: PrivacyDeps;
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
    d.onSettingsChanged();
    if (!d.settings.get().trackingPaused) d.tracker.start();
    return d.settings.get();
  });
  ipcMain.handle(CH.profileGet, () => readProfile(d.settings.get()));
  ipcMain.handle(CH.profileSave, (_e, raw) => {
    const next = d.settings.set(toSettingsPatch(profileInput.parse(raw)));
    d.onSettingsChanged();
    return next;
  });
  ipcMain.handle(CH.trackingStatus, () => d.tracker.status());
  ipcMain.handle(CH.trackingSet, (_e, raw) => { d.setTracking(z.boolean().parse(raw)); return d.tracker.status(); });

  const privacyView = (): PrivacyView => {
    const s = d.settings.get();
    const r = d.privacy.lastRead();
    return {
      screenReading: s.screenReading, retentionDays: s.rawTextRetentionDays, exclusions: parseExclusions(s.exclusions),
      ocrStatus: d.privacy.ocrStatus(),
      lastRead: r && r.text !== null ? { at: r.at, app: r.appName, title: r.windowTitle, text: r.text } : null
    };
  };
  ipcMain.handle(CH.privacyGet, () => privacyView());
  ipcMain.handle(CH.privacySetExclusions, (_e, raw) => {
    d.settings.set({ exclusions: JSON.stringify(exclusionsInput.parse(raw)) });
    return privacyView();
  });
  ipcMain.handle(CH.privacyExport, () => d.privacy.exportData());
  ipcMain.handle(CH.privacyDeleteActivity, () => d.privacy.deleteActivity());
  ipcMain.handle(CH.privacyOpenLanguageSettings, () => { d.privacy.openLanguageSettings(); });
}
