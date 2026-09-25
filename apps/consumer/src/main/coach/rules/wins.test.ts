import { describe, it, expect } from 'vitest';
import { emptyView, read, sess, snap, T } from '../fixtures';
import { belowAvg, deepWork } from './wins';

describe('deep_work', () => {
  it('fires at 60 and 90 minutes of work+learning with few switches', () => {
    const view = emptyView({ timeline: [{ start: T(10), end: T(10, 40), category: 'work' }, { start: T(10, 40), end: T(11, 32), category: 'learning' }] });
    expect(deepWork(snap({ view, now: T(11, 33) }))).toMatchObject({ ruleId: 'deep_work', key: `deep_work:${T(10)}:90` });
    const v60 = emptyView({ timeline: [{ start: T(10), end: T(11, 5), category: 'work' }] });
    expect(deepWork(snap({ view: v60, now: T(11, 6) }))?.key).toBe(`deep_work:${T(10)}:60`);
  });
  it('is blocked by many switches or high distraction', () => {
    const view = emptyView({ timeline: [{ start: T(10), end: T(11, 5), category: 'work' }] });
    const sessions = Array.from({ length: 12 }, (_, i) => sess(i % 2 ? 'Code' : 'Slack', T(10, 1 + i)));
    expect(deepWork(snap({ view, sessions, now: T(11, 6) }))).toBeNull();
    expect(deepWork(snap({ view, readsToday: [read(T(10, 30), 'Code', { distraction: 1.2 })], now: T(11, 6) }))).toBeNull();
  });
  it('is not blocked by title changes inside one app (12 Code sessions are 0 switches)', () => {
    const view = emptyView({ timeline: [{ start: T(10), end: T(11, 5), category: 'work' }] });
    const sessions = Array.from({ length: 12 }, (_, i) => sess('Code', T(10, 1 + i), null, `file${i}.ts`));
    expect(deepWork(snap({ view, sessions, now: T(11, 6) }))).toMatchObject({ ruleId: 'deep_work' });
  });
});

describe('below_avg', () => {
  it('fires at 18:00 when today is ≥ 10 % below the 7-day average', () => {
    const week = emptyView().week.map((d, i) => ({ ...d, seconds: i < 6 ? 6 * 3600 : 0 }));
    const s = snap({ now: T(18, 5), view: emptyView({ week, screenSec: 4 * 3600 }) });
    expect(belowAvg(s)).toMatchObject({ ruleId: 'below_avg', title: 'Down 33% today' });
    expect(belowAvg(snap({ now: T(17), view: emptyView({ week, screenSec: 4 * 3600 }) }))).toBeNull();
  });
  it('returns null with only 2 prior days of data', () => {
    const week = emptyView().week.map((d, i) => ({ ...d, seconds: i < 2 ? 6 * 3600 : 0 }));
    expect(belowAvg(snap({ now: T(18, 5), view: emptyView({ week, screenSec: 4 * 3600 }) }))).toBeNull();
  });
});
