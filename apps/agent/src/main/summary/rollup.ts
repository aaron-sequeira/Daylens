import type { FocusSessionRow, ActivitySampleRow, DaySummary, AppUsage, ISODate } from '../../shared/types';

const bucketSec = (s: ActivitySampleRow): number => Math.max(0, Math.round((s.bucketEnd - s.bucketStart) / 1000));

export function computeDaySummary(date: ISODate, sessions: FocusSessionRow[], samples: ActivitySampleRow[]): DaySummary {
  const totalTrackedSec = sessions.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
  const activeSec = samples.filter(s => s.active === 1).reduce((acc, s) => acc + bucketSec(s), 0);
  const idleSec = Math.max(0, totalTrackedSec - activeSec);

  const byApp = new Map<string, AppUsage>();
  for (const s of sessions) {
    const u = byApp.get(s.appName) ?? { appName: s.appName, totalSec: 0, sessions: 0, firstOpenAt: null, lastCloseAt: null, activePct: 0 };
    u.totalSec += s.durationSec ?? 0;
    u.sessions += 1;
    u.firstOpenAt = u.firstOpenAt === null ? s.startedAt : Math.min(u.firstOpenAt, s.startedAt);
    if (s.endedAt !== null) u.lastCloseAt = u.lastCloseAt === null ? s.endedAt : Math.max(u.lastCloseAt, s.endedAt);
    byApp.set(s.appName, u);
  }

  const appBuckets = new Map<string, { active: number; total: number }>();
  for (const s of samples) {
    if (!s.appName) continue;
    const b = appBuckets.get(s.appName) ?? { active: 0, total: 0 };
    const dur = bucketSec(s);
    b.total += dur;
    if (s.active === 1) b.active += dur;
    appBuckets.set(s.appName, b);
  }
  for (const u of byApp.values()) {
    const b = appBuckets.get(u.appName);
    u.activePct = b && b.total > 0 ? Math.round((b.active / b.total) * 100) : 0;
  }

  const apps = [...byApp.values()].sort((a, b) => b.totalSec - a.totalSec);
  return { date, totalTrackedSec, activeSec, idleSec, apps };
}
