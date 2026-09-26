import { describe, it, expect } from 'vitest';
import { buildCandidates } from './candidates';
import type { Episode } from './episodes';

const ep = (o: Partial<Episode>): Episode => ({ id: 'e1', start: 0, end: 12 * 60_000, app: 'Code', category: 'work', activity: 'coding',
  titles: ['build.ts'], samples: ['TypeError: x is undefined'], avgStuck: 0, avgDistraction: 0, stuckReads: 0, reads: 20, ...o });

describe('report candidates', () => {
  it('lists stuck episodes, repeated searches, nudges and passed limits with stable ids', () => {
    const c = buildCandidates({
      episodes: [ep({ id: 'e1', avgStuck: 1.6 }), ep({ id: 'e2', stuckReads: 3 }), ep({ id: 'e3' })],
      searches: [{ query: 'css grid', count: 3 }],
      nudges: [{ id: 7, ruleId: 'doomscroll', title: "You've been scrolling Reddit 20 min", status: 'dismissed' }],
      caps: [{ app: 'YouTube', minutes: 30, usedMin: 52 }]
    });
    expect(c.map((x) => x.id)).toEqual(['stuck:e1', 'stuck:e2', 'search:0', 'nudge:7', 'cap:YouTube']);
    expect(c[0]).toMatchObject({ kind: 'stuck', text: 'Stuck for 12 min in Code (build.ts)', sample: 'TypeError: x is undefined' });
    expect(c[2].text).toBe('Searched "css grid" 3 times this week');
    expect(c[3].text).toBe('Pop-up "You\'ve been scrolling Reddit 20 min" (dismissed)');
    expect(c[4].text).toBe('YouTube: 52 min used, limit 30 min');
  });
  it('caps error samples at 200 chars and omits them when absent', () => {
    const c = buildCandidates({ episodes: [ep({ avgStuck: 2, samples: ['e'.repeat(250)] }), ep({ id: 'e9', avgStuck: 2, samples: [] })], searches: [], nudges: [], caps: [] });
    expect(c[0].sample).toHaveLength(200);
    expect(c[1].sample).toBeUndefined();
  });
});
