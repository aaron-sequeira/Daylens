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
      caps: [{ app: 'YouTube', minutes: 30, usedMin: 52, usedMs: 52 * 60_000 }]
    });
    expect(c.map((x) => x.id)).toEqual(['stuck:e1', 'stuck:e2', 'search:0', 'nudge:7', 'cap:YouTube']);
    expect(c[0]).toMatchObject({ kind: 'stuck', text: 'Stuck for 12 min in Code (build.ts)', sample: 'TypeError: x is undefined' });
    expect(c[2].text).toBe('Searched "css grid" 3 times this week');
    expect(c[3].text).toBe('Pop-up "You\'ve been scrolling Reddit 20 min" (dismissed)');
    expect(c[4].text).toBe('YouTube: 52 min used, limit 30 min');
  });
  it('keeps reminder pop-ups out of the report candidates', () => {
    const c = buildCandidates({
      episodes: [], searches: [],
      nudges: [{ id: 1, ruleId: 'reminder', title: 'Time for some water 💧', status: 'shown' }, { id: 2, ruleId: 'doomscroll', title: 'Reddit', status: 'dismissed' }],
      caps: []
    });
    expect(c.map((x) => x.id)).toEqual(['nudge:2']);
  });
  it('lists a limit only once it is really passed, like the pop-up rule (not when rounding says so)', () => {
    const caps = [{ app: 'YouTube', minutes: 30, usedMin: 30, usedMs: 29.6 * 60_000 }, { app: 'Discord', minutes: 30, usedMin: 30, usedMs: 30 * 60_000 }];
    expect(buildCandidates({ episodes: [], searches: [], nudges: [], caps }).map((c) => c.id)).toEqual(['cap:Discord']);
  });
  it('caps each kind: 5 most-stuck episodes, 3 searches, 3 pop-ups, 3 limits; long titles cut to 80', () => {
    const c = buildCandidates({
      episodes: Array.from({ length: 8 }, (_, i) => ep({ id: `e${i}`, avgStuck: 2, stuckReads: i, titles: ['T'.repeat(150)] })),
      searches: Array.from({ length: 5 }, (_, n) => ({ query: `q${n}`, count: 3 })),
      nudges: Array.from({ length: 5 }, (_, n) => ({ id: n, ruleId: 'r', title: 't', status: 'dismissed' })),
      caps: Array.from({ length: 5 }, (_, n) => ({ app: `A${n}`, minutes: 30, usedMin: 40, usedMs: 40 * 60_000 }))
    });
    expect(c.filter((x) => x.kind === 'stuck').map((x) => x.id)).toEqual(['stuck:e7', 'stuck:e6', 'stuck:e5', 'stuck:e4', 'stuck:e3']);
    expect(c.filter((x) => x.kind === 'search')).toHaveLength(3);
    expect(c.filter((x) => x.kind === 'nudge')).toHaveLength(3);
    expect(c.filter((x) => x.kind === 'cap')).toHaveLength(3);
    expect(c[0].text).toBe(`Stuck for 12 min in Code (${'T'.repeat(80)})`);
  });
  it('ranks stuck episodes by average stuck score before stuck reads', () => {
    const c = buildCandidates({ episodes: [ep({ id: 'a', avgStuck: 1.6, stuckReads: 9 }), ep({ id: 'b', avgStuck: 2.5, stuckReads: 0 })], searches: [], nudges: [], caps: [] });
    expect(c.map((x) => x.id)).toEqual(['stuck:b', 'stuck:a']);
  });
  it('caps error samples at 200 chars and omits them when absent', () => {
    const c = buildCandidates({ episodes: [ep({ avgStuck: 2, samples: ['e'.repeat(250)] }), ep({ id: 'e9', avgStuck: 2, samples: [] })], searches: [], nudges: [], caps: [] });
    expect(c[0].sample).toHaveLength(200);
    expect(c[1].sample).toBeUndefined();
  });
});
