import type Database from 'better-sqlite3';
import type { ReportJson } from './schema';

export const REPORT_FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS report_fts USING fts5(date UNINDEXED, body, tokenize = 'unicode61');`;
export interface SearchHit { date: string; snippet: string; }
export interface ReportSearch { upsert(date: string, body: string): void; remove(date: string): void; search(raw: string): SearchHit[]; clear(): void; count(): number;
  /** Dates already in the index, for a startup backfill that should only touch what's missing. */
  indexedDates(): Set<string>; }

export function reportBody(r: ReportJson, topApps: string[]): string {
  return [r.headline, r.story, ...r.wins, ...r.habits, ...r.doBetter.flatMap((d) => [d.what, d.better]), r.advice, ...r.plan.map((p) => p.text), ...topApps].join('\n');
}

/** Words only, each quoted with a prefix star, so no user input can reach FTS5 query syntax. */
export function ftsQuery(raw: string): string | null {
  const terms = (raw.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null;
}

// Snippet highlight markers: control characters that never occur in real report text, so the renderer's
// snippetParts (renderer/lib/report.ts, which must use the same two characters) never mistakes literal
// "[" / "]" typed in a report for a match marker.
export const SNIPPET_MARK_OPEN = '\u0001';
export const SNIPPET_MARK_CLOSE = '\u0002';

export function createReportSearch(db: Database.Database): ReportSearch {
  const del = db.prepare('DELETE FROM report_fts WHERE date = ?');
  const ins = db.prepare('INSERT INTO report_fts (date, body) VALUES (?, ?)');
  const find = db.prepare(`SELECT date, snippet(report_fts, 1, '${SNIPPET_MARK_OPEN}', '${SNIPPET_MARK_CLOSE}', '…', 12) AS snippet FROM report_fts WHERE report_fts MATCH ? ORDER BY date DESC LIMIT 50`);
  const upsert = db.transaction((date: string, body: string) => { del.run(date); ins.run(date, body); });
  return {
    upsert: (date, body) => { upsert(date, body); },
    remove: (date) => { del.run(date); },
    search(raw) {
      const q = ftsQuery(raw);
      if (!q) return [];
      try { return find.all(q) as SearchHit[]; } catch (e) { console.error('[search] query failed:', String(e).slice(0, 80)); return []; }
    },
    clear: () => { db.exec('DELETE FROM report_fts'); },
    count: () => (db.prepare('SELECT count(*) AS n FROM report_fts').get() as { n: number }).n,
    indexedDates: () => new Set((db.prepare('SELECT date FROM report_fts').all() as { date: string }[]).map((r) => r.date))
  };
}
