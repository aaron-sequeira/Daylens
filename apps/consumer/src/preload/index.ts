import { contextBridge, ipcRenderer } from 'electron';
import type { TrackingStatus } from '@worksight/core/types';
import type { AiProvider } from '@worksight/core/ai';
import { CH } from '../main/channels';
import type { DaylensSettings, SettingsPatch } from '../main/settings';
import type { TodayView } from '../main/day/today';
import type { Profile } from '../shared/profileOptions';
import type { PrivacyView, ModelsView, CoachView, PlanTodayItem, ExportPdfResult } from '../main/ipc';
import type { SearchHit } from '../main/report/search';
import type { ReportView, WriterView } from '../main/report/view';

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
  reports: {
    get: (date?: string | null): Promise<ReportView> => ipcRenderer.invoke(CH.reportsGet, date ?? null),
    generate: (date: string): Promise<ReportView> => ipcRenderer.invoke(CH.reportsGenerate, date),
    cancel: (date: string): Promise<ReportView> => ipcRenderer.invoke(CH.reportsCancel, date),
    days: (): Promise<string[]> => ipcRenderer.invoke(CH.reportsDays),
    tickPlan: (date: string, index: number, on: boolean): Promise<ReportView> => ipcRenderer.invoke(CH.reportsTickPlan, { date, index, on }),
    exportPdf: (date: string): Promise<ExportPdfResult> => ipcRenderer.invoke(CH.reportsExportPdf, date),
    search: (q: string): Promise<SearchHit[]> => ipcRenderer.invoke(CH.reportsSearch, q)
  },
  writer: {
    get: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerGet),
    download: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerDownload),
    cancelDownload: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerCancelDownload),
    remove: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerDelete),
    decline: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerDecline),
    setMode: (m: 'local' | 'cloud'): Promise<WriterView> => ipcRenderer.invoke(CH.writerSetMode, m),
    setTier: (t: '' | '4b' | '1.7b'): Promise<WriterView> => ipcRenderer.invoke(CH.writerSetTier, t),
    setCloud: (c: { provider: AiProvider; model: string; baseUrl: string; key?: string }): Promise<WriterView> => ipcRenderer.invoke(CH.writerSetCloud, c),
    retryLocal: (): Promise<WriterView> => ipcRenderer.invoke(CH.writerRetryLocal)
  },
  plan: {
    today: (): Promise<PlanTodayItem[]> => ipcRenderer.invoke(CH.planToday),
    setEnabled: (id: number, on: boolean): Promise<PlanTodayItem[]> => ipcRenderer.invoke(CH.planSetEnabled, { id, on })
  },
  onUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(CH.eventsUpdate, listener);
    return () => ipcRenderer.off(CH.eventsUpdate, listener);
  },
  // Sent by the print route once its report DOM has painted, so the hidden export window
  // knows when to call webContents.printToPDF (see reportPdfElectron.ts).
  printReady: (): void => ipcRenderer.send('report:printReady')
};

export type DaylensApi = typeof api;
contextBridge.exposeInMainWorld('daylens', api);
