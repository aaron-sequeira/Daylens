import { describe, it, expect } from 'vitest';
import { read, sess, snap, T } from '../fixtures';
import { repeatSearch, stuckTip } from './tips';

describe('stuck_tip', () => {
  const inCode = [sess('Code', T(11))];
  const stuckAt = (...at: number[]) => at.map((t) => read(t, 'Code', { stuck: 1.6 }));
  it('fires on 3 stuck reads within 10 min in one app', () => {
    const reads = stuckAt(T(11, 50), T(11, 53), T(11, 56));
    expect(stuckTip(snap({ readsToday: reads, sessions: inCode, now: T(11, 57) }))).toMatchObject({ ruleId: 'stuck_tip', kind: 'tip', title: 'Stuck in Code?' });
    expect(stuckTip(snap({ readsToday: reads.slice(0, 2), sessions: inCode, now: T(11, 57) }))).toBeNull();
  });
  it('still fires when the labels arrive 20 min late, while the user is still in that app', () => {
    expect(stuckTip(snap({ readsToday: stuckAt(T(11, 20), T(11, 23), T(11, 26)), sessions: inCode, now: T(11, 46) }))).toMatchObject({ ruleId: 'stuck_tip' });
  });
  it('stays silent once the user moved to another app, or when the reads are stale or spread out', () => {
    const reads = stuckAt(T(11, 20), T(11, 23), T(11, 26));
    expect(stuckTip(snap({ readsToday: reads, sessions: [...inCode, sess('Google Chrome', T(11, 40))], now: T(11, 46) }))).toBeNull();
    expect(stuckTip(snap({ readsToday: reads, sessions: inCode, now: T(11, 57) }))).toBeNull(); // latest 31 min old
    expect(stuckTip(snap({ readsToday: stuckAt(T(11, 30), T(11, 36), T(11, 42)), sessions: inCode, now: T(11, 45) }))).toBeNull(); // 12-min span
  });
  it('describes being stuck without claiming a duration', () => {
    const c = stuckTip(snap({ readsToday: stuckAt(T(11, 50), T(11, 53), T(11, 56)), sessions: inCode, now: T(11, 57) }))!;
    expect(c.stat).toBe('stuck');
    expect(c.body).not.toMatch(/ten minutes|10 min/i);
    expect(c.body).toContain('explaining it out loud');
  });
});

describe('repeat_search', () => {
  it('fires when the same query appears 3 times in 7 days', () => {
    const titles = [T(9, 0, 20), T(9, 0, 22), T(9, 0, 25)].map((at) => ({ at, title: 'React  hooks - Google Search - Google Chrome' }));
    const result = repeatSearch(snap({ searchTitles: titles }));
    expect(result).toMatchObject({ ruleId: 'repeat_search', key: 'repeat_search:react hooks' });
    expect(result?.title).toContain('Searched');
    expect(result?.title).toContain('react hooks');
    expect(result?.title).toContain('3×');
    expect(repeatSearch(snap({ searchTitles: titles.slice(0, 2) }))).toBeNull();
  });
  it('counts the same query re-focused within 30 min once', () => {
    const q = 'React hooks - Google Search - Google Chrome';
    const refocused = [T(9), T(9, 5), T(9, 12), T(9, 29)].map((at) => ({ at, title: q }));
    expect(repeatSearch(snap({ searchTitles: refocused }))).toBeNull();
    const spaced = [T(9), T(9, 10), T(9, 30), T(9, 45), T(10)].map((at) => ({ at, title: q })); // counts at 9:00, 9:30, 10:00
    expect(repeatSearch(snap({ searchTitles: spaced }))?.stat).toBe('3×');
  });
});
