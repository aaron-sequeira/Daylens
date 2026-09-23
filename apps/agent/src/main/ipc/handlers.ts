import { ipcMain } from 'electron';
import { z } from 'zod';
import { CH } from './channels';
import { computeDaySummary, type Repositories, type Tracker } from '@worksight/core';
import type { SettingsStore } from '../settings';
import { generateAiSummary } from '../summary/ai';
import type { AppSettings } from '../../shared/types';
import type { CloudController } from '../cloud/controller';

const dayArg = z.object({ date: z.string() });
const settingsPatch = z.record(z.union([z.string(), z.number(), z.boolean()]));

export interface IpcDeps { repo: Repositories; settings: SettingsStore; tracker: Tracker; onTrackingChange: () => void; cloud: CloudController; }

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(CH.trackingGetStatus, () => deps.tracker.status());
  ipcMain.handle(CH.trackingPause, () => { deps.settings.set({ trackingPaused: true }); deps.tracker.stop(); deps.onTrackingChange(); });
  ipcMain.handle(CH.trackingResume, () => { deps.settings.set({ trackingPaused: false }); deps.tracker.start(); deps.onTrackingChange(); });

  ipcMain.handle(CH.summaryGetDay, (_e, raw) => {
    const { date } = dayArg.parse(raw);
    return computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date));
  });
  ipcMain.handle(CH.summaryGetDays, () => deps.repo.getAvailableDays());
  ipcMain.handle(CH.summaryGenerateAi, async (_e, raw) => {
    const { date } = dayArg.parse(raw);
    const s: AppSettings = deps.settings.get();
    if (!s.aiEnabled) return { error: 'no_key' };
    const summary = computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date));
    const result = await generateAiSummary(summary, { apiKey: deps.settings.getApiKey(), model: s.aiModel, provider: s.aiProvider, baseUrl: s.aiBaseUrl });
    if ('text' in result) {
      deps.repo.upsertDailySummary({
        date, totalTrackedSec: summary.totalTrackedSec, activeSec: summary.activeSec, idleSec: summary.idleSec,
        byAppJson: JSON.stringify(summary.apps), aiSummary: result.text, aiModel: result.model, aiGeneratedAt: result.generatedAt, updatedAt: Date.now()
      });
    }
    return result;
  });

  ipcMain.handle(CH.settingsGet, () => deps.settings.get());
  ipcMain.handle(CH.settingsSet, (_e, raw) => { deps.settings.set(settingsPatch.parse(raw) as never); return deps.settings.get(); });
  ipcMain.handle(CH.settingsSetApiKey, (_e, raw) => { deps.settings.setApiKey(z.string().parse(raw)); return deps.settings.get(); });
  ipcMain.handle(CH.dataClearAll, () => { deps.repo.clearAll(); });

  ipcMain.handle(CH.cloudGetStatus, () => deps.cloud.getStatus());
  ipcMain.handle(CH.cloudSignIn, (_e, raw) => {
    const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(raw);
    return deps.cloud.signIn(email, password);
  });
  ipcMain.handle(CH.cloudSignOut, () => { deps.cloud.signOut(); });
  ipcMain.handle(CH.cloudSetEnabled, (_e, raw) => { deps.cloud.setEnabled(z.boolean().parse(raw)); });
  ipcMain.handle(CH.cloudSyncNow, () => deps.cloud.syncNow());
}
