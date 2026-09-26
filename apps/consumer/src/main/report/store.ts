import type Database from 'better-sqlite3';
import { shiftDate } from '../day/time';
import { parsePlanItem, type PlanItem, type ReportJson } from './schema';

export const REPORT_SQL = `
CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT, model TEXT, generated_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus_block','app_cap','break_interval','wind_down')),
  payload_json TEXT NOT NULL, text TEXT NOT NULL, source_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plan_for ON plan_items(for_date);
`;

export interface ReportRow { date: string; status: 'pending' | 'ready' | 'failed'; report: ReportJson | null; model: string | null; generatedAt: number | null; error: string | null; }
export interface PlanItemRow { id: number; forDate: string; sourceDate: string; item: PlanItem; enabled: boolean; }
export interface ReportStore {
  get(date: string): ReportRow | null; dates(): string[];
  setPending(date: string, now: number): void; setReady(date: string, report: ReportJson, model: string, now: number): void; setFailed(date: string, error: string, now: number): void;
  /** A regenerate failed: keep the row (and its good report), only record why. */
  noteError(date: string, error: string): void;
  clearPending(now: number): void;
  plan(forDate: string): PlanItemRow[]; tickedTexts(sourceDate: string): string[];
  tick(sourceDate: string, item: PlanItem, on: boolean): void; setEnabled(id: number, on: boolean): void;
}

type RawReport = { date: string; status: ReportRow['status']; report_json: string | null; model: string | null; generated_at: number | null; error: string | null };
type RawPlan = { id: number; for_date: string; source_date: string; kind: string; text: string; payload_json: string; enabled: number };

export function createReportStore(db: Database.Database): ReportStore {
  const upsert = db.prepare(`INSERT INTO daily_reports (date, status, report_json, model, generated_at, error) VALUES (@date, @status, @report, @model, @at, @error)
    ON CONFLICT(date) DO UPDATE SET status = excluded.status, report_json = excluded.report_json, model = excluded.model, generated_at = excluded.generated_at, error = excluded.error`);
  const one = db.prepare('SELECT * FROM daily_reports WHERE date = ?');
  const all = db.prepare('SELECT date FROM daily_reports ORDER BY date DESC');
  const stale = db.prepare("UPDATE daily_reports SET status = 'failed', error = 'interrupted', generated_at = ? WHERE status = 'pending'");
  const note = db.prepare('UPDATE daily_reports SET error = ? WHERE date = ?');
  const planFor = db.prepare('SELECT * FROM plan_items WHERE for_date = ? ORDER BY id');
  const bySource = db.prepare('SELECT text FROM plan_items WHERE source_date = ? ORDER BY id');
  const find = db.prepare('SELECT id FROM plan_items WHERE source_date = ? AND kind = ? AND text = ?');
  const ins = db.prepare('INSERT INTO plan_items (for_date, kind, payload_json, text, source_date) VALUES (?, ?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM plan_items WHERE source_date = ? AND kind = ? AND text = ?');
  const en = db.prepare('UPDATE plan_items SET enabled = ? WHERE id = ?');
  const put = (date: string, status: ReportRow['status'], report: ReportJson | null, model: string | null, at: number, error: string | null): void => {
    upsert.run({ date, status, report: report ? JSON.stringify(report) : null, model, at, error });
  };
  const toPlan = (r: RawPlan): PlanItemRow | null => {
    try {
      const item = parsePlanItem({ kind: r.kind, text: r.text, payload: JSON.parse(r.payload_json) });
      return item ? { id: r.id, forDate: r.for_date, sourceDate: r.source_date, item, enabled: r.enabled === 1 } : null;
    } catch {
      return null;
    }
  };
  return {
    get(date) {
      const r = one.get(date) as RawReport | undefined;
      if (!r) return null;
      let report: ReportJson | null = null;
      let status: ReportRow['status'] = r.status;
      let error = r.error;
      try { report = r.report_json ? JSON.parse(r.report_json) as ReportJson : null; } catch {
        if (r.status === 'ready') { status = 'failed'; error = 'corrupt report'; }
      }
      return { date: r.date, status, report, model: r.model, generatedAt: r.generated_at, error };
    },
    dates: () => (all.all() as { date: string }[]).map((r) => r.date),
    setPending: (date, now) => put(date, 'pending', null, null, now, null),
    setReady: (date, report, model, now) => put(date, 'ready', report, model, now, null),
    setFailed: (date, error, now) => put(date, 'failed', null, null, now, error),
    noteError: (date, error) => { note.run(error, date); },
    clearPending: (now) => { stale.run(now); },
    plan: (forDate) => (planFor.all(forDate) as RawPlan[]).map(toPlan).filter((p): p is PlanItemRow => p !== null),
    tickedTexts: (sourceDate) => (bySource.all(sourceDate) as { text: string }[]).map((r) => r.text),
    tick(sourceDate, item, on) {
      if (!on) { del.run(sourceDate, item.kind, item.text); return; }
      if (!find.get(sourceDate, item.kind, item.text)) ins.run(shiftDate(sourceDate, 1), item.kind, JSON.stringify(item.payload), item.text, sourceDate);
    },
    setEnabled: (id, on) => { en.run(on ? 1 : 0, id); }
  };
}
