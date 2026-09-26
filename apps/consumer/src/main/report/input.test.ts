import { describe, it, expect } from 'vitest';
import { buildReportInput, buildStats, forCloud, INPUT_EPISODES, reportPrompt } from './input';
import type { Episode } from './episodes';
import type { TodayView } from '../day/today';

const view = { date: '2026-09-26', now: 0, screenSec: 6 * 3600, activeSec: 5 * 3600, goalSec: 7 * 3600, firstSeenAt: 0,
  cards: [{ category: 'work', seconds: 4 * 3600, apps: [] }, { category: 'social', seconds: 3600, apps: [] }], timeline: [],
  health: { score: 80, breaks: 3, expectedBreaks: 6, longestStretchSec: 5400, lateNight: false },
  week: [0, 1, 2, 3, 4, 5].map((i) => ({ date: `d${i}`, seconds: i === 5 ? 6 * 3600 : 4 * 3600, byCategory: {} })).concat([{ date: '2026-09-26', seconds: 6 * 3600, byCategory: {} }]),
  apps: Array.from({ length: 8 }, (_, i) => ({ appName: `app${i}`, seconds: 1000 - i }))
} as unknown as TodayView;
const ep = (i: number, minutes: number): Episode => ({ id: `e${i}`, start: new Date(2026, 8, 26, 9, i).getTime(), end: new Date(2026, 8, 26, 9, i).getTime() + minutes * 60_000,
  app: 'Code', category: 'work', activity: 'coding', titles: ['t'], samples: ['s'], avgStuck: 0.25, avgDistraction: 0.1, stuckReads: 0, reads: 5 });

describe('report input', () => {
  it('builds stats from the day view (numbers never from the model)', () => {
    const s = buildStats(view, [ep(1, 30)], 42);
    expect(s).toMatchObject({ date: '2026-09-26', screenSec: 21600, deepWorkSec: 1800, switches: 42, health: { score: 80 } });
    expect(s.topApps).toHaveLength(5);
    expect(s.weekAvgSec).toBe((5 * 4 * 3600 + 6 * 3600) / 6); // the 6 days before, excluding the report date
  });
  it('passes the 40 longest episodes in time order, compacted', () => {
    const eps = Array.from({ length: 50 }, (_, i) => ep(i, i + 1));
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(input.episodes).toHaveLength(INPUT_EPISODES);
    expect(input.episodes[0]).toMatchObject({ id: 'e10', start: '09:10', minutes: 11, stuck: 0.3, distraction: 0.1 });
  });
  it('builds a prompt that names candidate ids and forbids invented numbers', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [{ id: 'stuck:e1', kind: 'stuck', text: 'Stuck' }], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const p = reportPrompt(input);
    expect(p.system).toMatch(/candidateId/);
    expect(p.system).toMatch(/do not invent/i);
    expect(p.user).toContain('"stuck:e1"');
  });
  it('strips every screen-text sample for the cloud, leaving the rest intact', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [ep(1, 30)], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 },
      candidates: [{ id: 'stuck:e1', kind: 'stuck', text: 'Stuck', sample: 'TypeError: secret' }] });
    const c = forCloud(input);
    expect(c.episodes[0].samples).toEqual([]);
    expect(c.candidates[0]).toEqual({ id: 'stuck:e1', kind: 'stuck', text: 'Stuck' });
    expect(c.episodes[0].titles).toEqual(['t']);
    expect(reportPrompt(c).user).not.toMatch(/secret|"s"\]/);
    expect(input.episodes[0].samples).toEqual(['s']); // the original is not mutated
    expect(input.candidates[0].sample).toBe('TypeError: secret');
  });
});
