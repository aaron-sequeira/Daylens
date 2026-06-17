import type { AppSettings, CloudSyncStatus, DailyActivityRow, ISODate, FocusSessionRow, ActivitySampleRow } from '../../shared/types';
import { syncWindow } from './sync';
import type { SessionManager } from './session';

export interface CloudControllerDeps {
  session: SessionManager;
  settings: { get(): AppSettings; set(p: Partial<AppSettings>): void };
  repo: { getFocusSessions(d: ISODate): FocusSessionRow[]; getActivitySamples(d: ISODate): ActivitySampleRow[] };
  upsert(token: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }>;
  now(): number;
}
export interface CloudController {
  getStatus(): CloudSyncStatus;
  signIn(email: string, password: string): Promise<{ ok: true } | { error: string }>;
  signOut(): void;
  setEnabled(enabled: boolean): void;
  syncNow(): Promise<{ syncedDays: number } | { error: string }>;
  maybeAutoSync(): Promise<void>;
}

export function createCloudController(deps: CloudControllerDeps): CloudController {
  let lastSyncedAt: number | null = null;
  let lastError: string | null = null;

  const controller: CloudController = {
    getStatus() {
      const acct = deps.session.getAccount();
      return { connected: acct !== null, email: acct?.email ?? null, enabled: deps.settings.get().cloudSyncEnabled, lastSyncedAt, lastError };
    },
    signIn(email, password) { return deps.session.signIn(email, password); },
    signOut() { deps.session.signOut(); lastSyncedAt = null; lastError = null; },
    setEnabled(enabled) { deps.settings.set({ cloudSyncEnabled: enabled }); },
    async syncNow() {
      const acct = deps.session.getAccount();
      if (!acct) { lastError = 'not signed in'; return { error: 'not signed in' }; }
      const res = await syncWindow({
        userId: acct.userId, windowDays: deps.settings.get().cloudSyncWindowDays, now: deps.now,
        repo: deps.repo, getValidAccessToken: deps.session.getValidAccessToken, upsert: deps.upsert
      });
      if ('error' in res) { lastError = res.error; return { error: res.error }; }
      lastSyncedAt = res.lastSyncedAt; lastError = null;
      return { syncedDays: res.syncedDays };
    },
    async maybeAutoSync() {
      if (!deps.settings.get().cloudSyncEnabled || !deps.session.getAccount()) return;
      await controller.syncNow();
    }
  };
  return controller;
}
