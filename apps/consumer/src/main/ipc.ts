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
import type { ModelStatus } from './models/downloader';
import type { LabellingStatus } from './brain/scheduler';
import type { DayLabel } from './screen/labels';
import { kindsInput, limitsInput, snoozeInput, parseFewer, parseKinds, parseLimits, resetFewerOnEnable } from './coach/settings';
import { nextEarlyMorning } from './day/time';
import type { AppLimit, Kind } from './coach/types';
import type { AiProvider } from '@worksight/core/ai';
import type { ReportView, WriterView } from './report/view';

const dateArg = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

export interface ModelsView { model: ModelStatus; labelling: LabellingStatus; }
export interface ModelsDeps {
  view(): ModelsView;
  redownload(): Promise<ModelsView>;
  remove(): Promise<{ deleted: boolean }>;
  retryLabelling(): ModelsView;
}

export interface CoachView { kinds: Record<Kind, boolean>; snoozeUntil: number; limits: AppLimit[]; held: { id: number; at: number; kind: Kind; title: string; body: string }[]; }
export interface CoachIpcDeps { held(): CoachView['held']; dismissHeld(id: number): void; test(): void; onChanged(): void; }

export type ExportPdfResult = { ok: true; path: string } | { ok: false; reason: string } | { ok: false; cancelled: true };
export interface ReportsDeps {
  view(date: string | null): ReportView;
  days(): string[];
  generate(date: string): ReportView;
  cancel(date: string): ReportView;
  tickPlan(date: string, index: number, on: boolean): ReportView;
  exportPdf(date: string): Promise<ExportPdfResult>;
}
export interface PlanTodayItem { id: number; text: string; enabled: boolean; }
export interface PlanDeps {
  today(): PlanTodayItem[];
  setEnabled(id: number, on: boolean): PlanTodayItem[];
}
export interface WriterCloudInput { provider: AiProvider; model: string; baseUrl: string; key?: string; }
export interface WriterDeps {
  view(): WriterView;
  download(): WriterView;
  cancelDownload(): WriterView;
  remove(): Promise<WriterView>;
  decline(): WriterView;
  setMode(m: 'local' | 'cloud'): WriterView;
  setTier(t: '' | '4b' | '1.7b'): Promise<WriterView>;
  setCloud(c: WriterCloudInput): WriterView;
  retryLocal(): WriterView;
}

export interface IpcDeps {
  repo: Repositories;
  settings: KvStore<DaylensSettings>;
  tracker: Tracker;
  setTracking(on: boolean): void;
  onSettingsChanged(): void;
  now(): number;
  privacy: PrivacyDeps;
  models: ModelsDeps;
  labelsFor(date: string): DayLabel[];
  breaksFor(date: string): number[];
  coach: CoachIpcDeps;
  reports: ReportsDeps;
  writer: WriterDeps;
  plan: PlanDeps;
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(CH.todayGet, (_e, raw) => loadTodayView(d.repo, d.settings.get(), dateArg.parse(raw).date, d.now(), d.labelsFor, d.breaksFor));
  ipcMain.handle(CH.settingsGet, () => d.settings.get());
  ipcMain.handle(CH.settingsSet, (_e, raw) => {
    const patch = settingsPatch.parse(raw);
    const next = d.settings.set(patch.screenReading ? { ...patch, screenReadingAsked: true } : patch);
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

  ipcMain.handle(CH.modelsGet, () => d.models.view());
  ipcMain.handle(CH.modelsRedownload, () => d.models.redownload());
  ipcMain.handle(CH.modelsDelete, () => d.models.remove());
  ipcMain.handle(CH.modelsRetryLabelling, () => d.models.retryLabelling());

  const coachView = (): CoachView => {
    const s = d.settings.get();
    return { kinds: parseKinds(s.nudgeKinds), snoozeUntil: s.snoozeUntil, limits: parseLimits(s.appLimits), held: d.coach.held() };
  };
  ipcMain.handle(CH.coachGet, () => coachView());
  ipcMain.handle(CH.coachSetKinds, (_e, raw) => {
    const next = kindsInput.parse(raw);
    const s = d.settings.get();
    const fewer = resetFewerOnEnable(parseKinds(s.nudgeKinds), next, parseFewer(s.nudgeFewer));
    d.settings.set({ nudgeKinds: JSON.stringify(next), nudgeFewer: JSON.stringify(fewer) });
    d.coach.onChanged();
    return coachView();
  });
  ipcMain.handle(CH.coachSetLimits, (_e, raw) => { d.settings.set({ appLimits: JSON.stringify(limitsInput.parse(raw)) }); return coachView(); });
  ipcMain.handle(CH.coachSnooze, (_e, raw) => {
    const v = snoozeInput.parse(raw);
    const now = d.now();
    d.settings.set({ snoozeUntil: v === 'off' ? 0 : v === '1h' ? now + 3_600_000 : nextEarlyMorning(now) });
    d.coach.onChanged();
    return coachView();
  });
  ipcMain.handle(CH.coachDismissHeld, (_e, raw) => { d.coach.dismissHeld(z.number().int().parse(raw)); return coachView(); });
  ipcMain.handle(CH.coachTest, () => { d.coach.test(); });

  ipcMain.handle(CH.reportsGet, (_e, raw) => d.reports.view(raw === null || raw === undefined ? null : dateStr.parse(raw)));
  ipcMain.handle(CH.reportsGenerate, (_e, raw) => d.reports.generate(dateStr.parse(raw)));
  ipcMain.handle(CH.reportsDays, () => d.reports.days());
  ipcMain.handle(CH.reportsCancel, (_e, raw) => d.reports.cancel(dateStr.parse(raw)));
  ipcMain.handle(CH.reportsTickPlan, (_e, raw) => {
    const v = z.object({ date: dateStr, index: z.number().int().min(0).max(3), on: z.boolean() }).strict().parse(raw);
    return d.reports.tickPlan(v.date, v.index, v.on);
  });
  ipcMain.handle(CH.reportsExportPdf, (_e, raw) => d.reports.exportPdf(dateStr.parse(raw)));
  ipcMain.handle(CH.writerGet, () => d.writer.view());
  ipcMain.handle(CH.writerDownload, () => d.writer.download());
  ipcMain.handle(CH.writerCancelDownload, () => d.writer.cancelDownload());
  ipcMain.handle(CH.writerDelete, () => d.writer.remove());
  ipcMain.handle(CH.writerDecline, () => d.writer.decline());
  ipcMain.handle(CH.writerSetMode, (_e, raw) => d.writer.setMode(z.enum(['local', 'cloud']).parse(raw)));
  ipcMain.handle(CH.writerSetTier, (_e, raw) => d.writer.setTier(z.enum(['', '4b', '1.7b']).parse(raw)));
  ipcMain.handle(CH.writerSetCloud, (_e, raw) => d.writer.setCloud(z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']), model: z.string().trim().min(1).max(120),
    baseUrl: z.string().trim().max(300).refine((u) => u === '' || /^https:\/\//.test(u), 'https only'), key: z.string().trim().min(1).max(400).optional()
  }).strict().parse(raw)));
  ipcMain.handle(CH.writerRetryLocal, () => d.writer.retryLocal());

  ipcMain.handle(CH.planToday, () => d.plan.today());
  ipcMain.handle(CH.planSetEnabled, (_e, raw) => {
    const v = z.object({ id: z.number().int().min(1), on: z.boolean() }).strict().parse(raw);
    return d.plan.setEnabled(v.id, v.on);
  });
}
