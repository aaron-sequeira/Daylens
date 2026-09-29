import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createReportSearch, ftsQuery, REPORT_FTS_SQL, reportBody } from './search';
import type { ReportJson } from './schema';

const rep = (o: Partial<ReportJson> = {}): ReportJson => ({ headline: 'A focused morning', story: 'You fixed the Figma export bug.', wins: ['Shipped the pill'], habits: ['Late YouTube'],
  doBetter: [{ candidateId: 'stuck:e1', what: 'Stuck on a TypeError', better: 'Read the stack first' }], plan: [{ kind: 'wind_down', text: 'Bed by 23:00', payload: { time: '23:00' } }], advice: 'Rest more.', ...o });
const mk = () => { const db = new Database(':memory:'); db.exec(REPORT_FTS_SQL); return createReportSearch(db); };

describe('report search', () => {
  it('builds a searchable body from the report text and top apps', () => {
    const b = reportBody(rep(), ['Figma', 'Code']);
    for (const w of ['focused', 'Figma export', 'Shipped', 'YouTube', 'TypeError', 'stack', 'Bed by', 'Rest', 'Code']) expect(b).toContain(w);
  });
  it('sanitises queries into quoted prefix terms and rejects empty ones', () => {
    expect(ftsQuery('figma bug')).toBe('"figma"* "bug"*');
    expect(ftsQuery('  "quote" OR -x NEAR(a b) col:val * ')).toBe('"quote"* "OR"* "x"* "NEAR"* "a"* "b"* "col"* "val"*');
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('  ** -- ')).toBeNull();
  });
  it('finds reports newest first with a highlighted snippet, and upsert replaces', () => {
    const s = mk();
    s.upsert('2026-09-20', reportBody(rep({ story: 'You worked in Figma all day.' }), []));
    s.upsert('2026-09-25', reportBody(rep({ story: 'Figma again, then YouTube.' }), []));
    s.upsert('2026-09-22', reportBody(rep({ story: 'Only email today.', headline: 'Quiet', wins: [], habits: [], doBetter: [], plan: [], advice: 'x' }), []));
    const hits = s.search('figma');
    expect(hits.map((h) => h.date)).toEqual(['2026-09-25', '2026-09-20']);
    expect(hits[0].snippet).toMatch(/\u0001Figma\u0002/i);
    s.upsert('2026-09-25', reportBody(rep({ story: 'Nothing relevant.', headline: 'H', wins: [], habits: [], doBetter: [], plan: [], advice: 'a' }), []));
    expect(s.search('figma').map((h) => h.date)).toEqual(['2026-09-20']);
  });
  it('reports which dates are already indexed, for a startup backfill to skip', () => {
    const s = mk();
    expect(s.indexedDates()).toEqual(new Set());
    s.upsert('2026-09-20', reportBody(rep(), []));
    s.upsert('2026-09-22', reportBody(rep(), []));
    expect(s.indexedDates()).toEqual(new Set(['2026-09-20', '2026-09-22']));
    s.remove('2026-09-20');
    expect(s.indexedDates()).toEqual(new Set(['2026-09-22']));
  });
  it('never throws on FTS syntax, caps at 50, and clears', () => {
    const s = mk();
    for (let i = 1; i <= 60; i++) s.upsert(`2026-07-${String((i % 28) + 1).padStart(2, '0')}-${i}`, 'figma');
    expect(() => s.search('"unterminated')).not.toThrow();
    expect(() => s.search('a AND OR NOT')).not.toThrow();
    expect(s.search('figma').length).toBeLessThanOrEqual(50);
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.search('')).toEqual([]);
  });
});
