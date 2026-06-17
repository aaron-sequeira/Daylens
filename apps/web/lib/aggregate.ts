import type { DailyActivity, Trend, MemberPeriodStats, TeamAggregate } from './types';

export const REFERENCE_ACTIVE_HOURS = 6;

export function activePct(a: DailyActivity): number {
  return a.totalTrackedSec > 0 ? (a.activeSec / a.totalTrackedSec) * 100 : 0;
}

export function activeHours(a: DailyActivity): number {
  return a.activeSec / 3600;
}

export function activityScore(a: DailyActivity, ref = REFERENCE_ACTIVE_HOURS): number {
  if (a.totalTrackedSec <= 0) return 0;
  const pct = a.activeSec / a.totalTrackedSec;
  const coverage = Math.min(activeHours(a) / ref, 1);
  return Math.round(pct * coverage * 100);
}

export function selfTrend(current: number, prior: number, epsilon = 2): Trend {
  const delta = Math.round(current - prior);
  const direction = Math.abs(delta) <= epsilon ? 'flat' : delta > 0 ? 'up' : 'down';
  return { delta, direction };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function memberPeriodStats(
  userId: string, fullName: string, current: DailyActivity[], prior: DailyActivity[]
): MemberPeriodStats {
  const curScore = Math.round(mean(current.map((d) => activityScore(d))));
  const priorScore = Math.round(mean(prior.map((d) => activityScore(d))));
  return {
    userId, fullName,
    avgActiveHours: mean(current.map(activeHours)),
    avgActivePct: mean(current.map(activePct)),
    activityScore: curScore,
    daysWithData: current.length,
    trend: selfTrend(curScore, priorScore)
  };
}

export function teamAggregate(current: DailyActivity[]): TeamAggregate {
  const byDate = new Map<string, number>();
  const byApp = new Map<string, number>();
  const users = new Set<string>();
  for (const d of current) {
    users.add(d.userId);
    byDate.set(d.date, (byDate.get(d.date) ?? 0) + activeHours(d));
    for (const app of d.byApp) byApp.set(app.appName, (byApp.get(app.appName) ?? 0) + app.totalSec);
  }
  let topApp: string | null = null, topSec = -1;
  for (const [name, sec] of byApp) if (sec > topSec) { topApp = name; topSec = sec; }
  return {
    totalActiveHours: current.reduce((s, d) => s + activeHours(d), 0),
    avgActivePct: mean(current.map(activePct)),
    membersTracked: users.size,
    topApp,
    series: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, activeHours]) => ({ date, activeHours }))
  };
}
