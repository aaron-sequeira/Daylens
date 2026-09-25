import type Database from 'better-sqlite3';
import type { NudgeRow, NudgeStatus } from './types';

export const COACH_SCHEMA = `
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')),
  rule_id TEXT NOT NULL, key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired'))
);
CREATE INDEX IF NOT EXISTS idx_nudges_date ON nudges(date, at);
CREATE INDEX IF NOT EXISTS idx_nudges_at ON nudges(at);
CREATE TABLE IF NOT EXISTS breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL, seconds INTEGER NOT NULL, completed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_breaks_date ON breaks(date, at);
`;

export interface CoachStore {
  record(n: Omit<NudgeRow, 'id'>): number;
  setStatus(id: number, status: NudgeStatus): void;
  since(ms: number): NudgeRow[];
  heldForDay(date: string): NudgeRow[];
  recordBreak(b: { at: number; date: string; kind: 'eye' | 'stretch'; seconds: number; completed: boolean }): void;
  lastCompletedBreakAt(): number | null;
  completedBreaksForDay(date: string): number[];
  clear(): void;
}

const COLS = 'id, at, date, kind, rule_id AS ruleId, key, title, body, status';

export function createCoachStore(db: Database.Database): CoachStore {
  const ins = db.prepare('INSERT INTO nudges (at, date, kind, rule_id, key, title, body, status) VALUES (@at, @date, @kind, @ruleId, @key, @title, @body, @status)');
  const upd = db.prepare('UPDATE nudges SET status = ? WHERE id = ?');
  const since = db.prepare(`SELECT ${COLS} FROM nudges WHERE at >= ? ORDER BY at, id`);
  const held = db.prepare(`SELECT ${COLS} FROM nudges WHERE date = ? AND status = 'held' ORDER BY at, id`);
  const brk = db.prepare('INSERT INTO breaks (at, date, kind, seconds, completed) VALUES (@at, @date, @kind, @seconds, @completed)');
  const lastBrk = db.prepare('SELECT max(at) AS t FROM breaks WHERE completed = 1');
  const dayBrk = db.prepare('SELECT at FROM breaks WHERE date = ? AND completed = 1 ORDER BY at');
  return {
    record: (n) => Number(ins.run(n).lastInsertRowid),
    setStatus: (id, status) => { upd.run(status, id); },
    since: (ms) => since.all(ms) as NudgeRow[],
    heldForDay: (date) => held.all(date) as NudgeRow[],
    recordBreak: (b) => { brk.run({ ...b, completed: b.completed ? 1 : 0 }); },
    lastCompletedBreakAt: () => (lastBrk.get() as { t: number | null }).t,
    completedBreaksForDay: (date) => (dayBrk.all(date) as { at: number }[]).map((r) => r.at),
    clear: () => { db.exec('DELETE FROM nudges; DELETE FROM breaks;'); }
  };
}
