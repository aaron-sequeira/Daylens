import { describe, it, expect } from 'vitest';
import { activePct, activeHours, activityScore, selfTrend, memberPeriodStats, teamAggregate } from './aggregate';
import type { DailyActivity } from './types';

const day = (o: Partial<DailyActivity>): DailyActivity => ({
  userId: 'u1', date: '2026-06-01', totalTrackedSec: 0, activeSec: 0, idleSec: 0, byApp: [], ...o
});

describe('activePct / activeHours', () => {
  it('computes active percent and hours', () => {
    const a = day({ totalTrackedSec: 7200, activeSec: 3600 });
    expect(activePct(a)).toBe(50);
    expect(activeHours(a)).toBe(1);
  });
  it('is 0% when nothing tracked', () => {
    expect(activePct(day({}))).toBe(0);
  });
});

describe('activityScore', () => {
  it('rewards a full, highly-active day', () => {
    // 7h tracked, 6.3h active -> active% 90, coverage min(6.3/6,1)=1 -> 90
    const a = day({ totalTrackedSec: 25200, activeSec: 22680 });
    expect(activityScore(a)).toBe(90);
  });
  it('penalizes low coverage (30 min, 100% active)', () => {
    // 0.5h active, coverage 0.5/6 -> ~0.083, active% 100 -> round(100*0.0833)=8
    const a = day({ totalTrackedSec: 1800, activeSec: 1800 });
    expect(activityScore(a)).toBe(8);
  });
  it('is 0 when nothing tracked', () => {
    expect(activityScore(day({}))).toBe(0);
  });
});

describe('selfTrend', () => {
  it('flat within epsilon', () => {
    expect(selfTrend(70, 69)).toEqual({ delta: 1, direction: 'flat' });
  });
  it('up beyond epsilon', () => {
    expect(selfTrend(80, 70)).toEqual({ delta: 10, direction: 'up' });
  });
  it('down beyond epsilon', () => {
    expect(selfTrend(60, 70)).toEqual({ delta: -10, direction: 'down' });
  });
  it('treats exactly epsilon (2) as flat and just over (3) as a move', () => {
    expect(selfTrend(72, 70)).toEqual({ delta: 2, direction: 'flat' });
    expect(selfTrend(73, 70)).toEqual({ delta: 3, direction: 'up' });
  });
});

describe('memberPeriodStats', () => {
  it('averages score across days and trends vs prior period', () => {
    const cur = [day({ totalTrackedSec: 25200, activeSec: 22680 }), day({ date: '2026-06-02', totalTrackedSec: 25200, activeSec: 22680 })];
    const prior = [day({ date: '2026-05-20', totalTrackedSec: 1800, activeSec: 1800 })];
    const s = memberPeriodStats('u1', 'Pat', cur, prior);
    expect(s.userId).toBe('u1');
    expect(s.daysWithData).toBe(2);
    expect(s.activityScore).toBe(90);
    expect(s.trend.direction).toBe('up'); // 90 vs 8
  });
  it('handles a member with no data', () => {
    const s = memberPeriodStats('u9', 'Sam', [], []);
    expect(s.activityScore).toBe(0);
    expect(s.daysWithData).toBe(0);
    expect(s.trend.direction).toBe('flat');
  });
});

describe('teamAggregate', () => {
  it('sums active hours, finds top app, builds a per-day series', () => {
    const rows = [
      day({ userId: 'a', date: '2026-06-01', totalTrackedSec: 7200, activeSec: 3600, byApp: [{ appName: 'VS Code', totalSec: 3000, sessions: 2, activePct: 80 }] }),
      day({ userId: 'b', date: '2026-06-01', totalTrackedSec: 7200, activeSec: 3600, byApp: [{ appName: 'VS Code', totalSec: 1000, sessions: 1, activePct: 70 }] }),
      day({ userId: 'a', date: '2026-06-02', totalTrackedSec: 7200, activeSec: 7200, byApp: [{ appName: 'Chrome', totalSec: 2000, sessions: 1, activePct: 90 }] })
    ];
    const t = teamAggregate(rows);
    expect(t.totalActiveHours).toBeCloseTo(4); // 1 + 1 + 2
    expect(t.membersTracked).toBe(2);
    expect(t.topApp).toBe('VS Code'); // 4000 vs Chrome 2000
    expect(t.series.map((s) => s.date)).toEqual(['2026-06-01', '2026-06-02']);
    expect(t.series[0].activeHours).toBeCloseTo(2);
  });
});
