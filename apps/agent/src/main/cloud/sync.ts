import type { DaySummary, DailyActivityRow, ISODate, FocusSessionRow, ActivitySampleRow } from '../../shared/types';
import { computeDaySummary } from '../summary/rollup';
import { localDate } from '../../shared/date';

const nn = (n: number): number => Math.max(0, Math.round(n));

export function mapDaySummaryToRow(userId: string, s: DaySummary): DailyActivityRow {
  return {
    user_id: userId,
    date: s.date,
    total_tracked_sec: nn(s.totalTrackedSec),
    active_sec: nn(s.activeSec),
    idle_sec: nn(s.idleSec),
    by_app: s.apps.map((a) => ({ app_name: a.appName, total_sec: nn(a.totalSec), sessions: nn(a.sessions), active_pct: nn(a.activePct) }))
  };
}

export function recentDates(windowDays: number, nowMs: number): ISODate[] {
  const out: ISODate[] = [];
  for (let i = windowDays - 1; i >= 0; i--) out.push(localDate(nowMs - i * 86_400_000));
  return out;
}

export interface SyncDeps {
  userId: string;
  windowDays: number;
  now(): number;
  repo: { getFocusSessions(d: ISODate): FocusSessionRow[]; getActivitySamples(d: ISODate): ActivitySampleRow[] };
  getValidAccessToken(): Promise<string | null>;
  upsert(token: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }>;
}

export async function syncWindow(deps: SyncDeps): Promise<{ syncedDays: number; lastSyncedAt: number } | { error: string }> {
  const token = await deps.getValidAccessToken();
  if (!token) return { error: 'not signed in' };
  const rows = recentDates(deps.windowDays, deps.now()).map((date) =>
    mapDaySummaryToRow(deps.userId, computeDaySummary(date, deps.repo.getFocusSessions(date), deps.repo.getActivitySamples(date)))
  );
  const res = await deps.upsert(token, rows);
  if ('error' in res) return { error: res.error };
  return { syncedDays: rows.length, lastSyncedAt: deps.now() };
}
