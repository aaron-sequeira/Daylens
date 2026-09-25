import { describe, it, expect } from 'vitest';
import { MIN, read, snap, T } from '../fixtures';
import { repeatSearch, stuckTip } from './tips';

describe('stuck_tip', () => {
  it('fires on 3 stuck reads within 10 min in one app', () => {
    const reads = [0, 3, 6].map((m) => read(T(11, 50) + m * MIN, 'Code', { stuck: 1.6 }));
    expect(stuckTip(snap({ readsToday: reads, now: T(11, 57) }))).toMatchObject({ ruleId: 'stuck_tip', kind: 'tip', title: 'Stuck in Code?' });
    expect(stuckTip(snap({ readsToday: reads.slice(0, 2), now: T(11, 57) }))).toBeNull();
  });
});

describe('repeat_search', () => {
  it('fires when the same query appears 3 times in 7 days', () => {
    const titles = [T(9, 0, 20), T(9, 0, 22), T(9, 0, 25)].map((at) => ({ at, title: 'React  hooks - Google Search - Google Chrome' }));
    expect(repeatSearch(snap({ searchTitles: titles }))).toMatchObject({ ruleId: 'repeat_search', key: 'repeat_search:react hooks' });
    expect(repeatSearch(snap({ searchTitles: titles.slice(0, 2) }))).toBeNull();
  });
});
