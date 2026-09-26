import { describe, it, expect } from 'vitest';
import { buildEpisodes, deepWorkSec } from './episodes';
import type { EpisodeRead } from '../screen/labels';

const MIN = 60_000, T0 = new Date(2026, 8, 26, 9, 0).getTime();
const r = (i: number, min: number, o: Partial<EpisodeRead> = {}): EpisodeRead => ({ id: i, at: T0 + min * MIN, appName: 'Code', windowTitle: 'index.ts - app',
  text: `text ${i}`, category: 'work', conf: 0.9, activity: 'coding', stuck: 0, distraction: 0, ...o });

describe('episodes', () => {
  it('groups consecutive reads of the same app and category with gaps under 5 min', () => {
    const eps = buildEpisodes([r(1, 0), r(2, 2), r(3, 4), r(4, 12), r(5, 13, { appName: 'chrome', category: 'social' })], true);
    expect(eps.map((e) => [e.app, e.reads])).toEqual([['Code', 3], ['Code', 1], ['chrome', 1]]);
    expect(eps[0]).toMatchObject({ id: 'e1', start: T0, end: T0 + 4 * MIN + 30_000, category: 'work', activity: 'coding', titles: ['index.ts - app'] });
  });
  it('uses the final category (unsure Laya on a known app falls back to the app category)', () => {
    const eps = buildEpisodes([r(1, 0, { appName: 'Discord', category: 'work', conf: 0.3 }), r(2, 1, { appName: 'Discord', category: null, conf: null })], false);
    expect(eps).toHaveLength(1);
    expect(eps[0].category).toBe('social');
  });
  it('keeps samples only when allowed and present, max 3 × 300 chars, stuck reads first', () => {
    const long = 'x'.repeat(400);
    const eps = buildEpisodes([r(1, 0, { text: 'a' }), r(2, 1, { text: long, stuck: 2 }), r(3, 2, { text: null }), r(4, 3, { text: 'b' }), r(5, 4, { text: 'c' })], true);
    expect(eps[0].samples).toEqual(['x'.repeat(300), 'a', 'b']);
    expect(buildEpisodes([r(1, 0)], false)[0].samples).toEqual([]);
  });
  it('averages stuck/distraction and counts stuck reads', () => {
    const [e] = buildEpisodes([r(1, 0, { stuck: 2 }), r(2, 1, { stuck: 1 }), r(3, 2, { stuck: null, distraction: 2 })], false);
    expect(e.avgStuck).toBe(1.5);
    expect(e.avgDistraction).toBeCloseTo(2 / 3);
    expect(e.stuckReads).toBe(1);
  });
  it('counts deep work: work/learning ≥ 25 min with low distraction', () => {
    const long = Array.from({ length: 27 }, (_, i) => r(i + 1, i));                       // 26.5 min of work
    const noisy = Array.from({ length: 27 }, (_, i) => r(100 + i, 60 + i, { distraction: 1 }));
    const short = Array.from({ length: 10 }, (_, i) => r(200 + i, 120 + i));
    expect(deepWorkSec(buildEpisodes([...long, ...noisy, ...short], false))).toBe(26.5 * 60);
  });
});
