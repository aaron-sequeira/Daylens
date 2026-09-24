import type Database from 'better-sqlite3';
import type { DaylensSettings } from '../settings';
import type { Profile } from '../../shared/profileOptions';

export const SCREEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS screen_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, date TEXT NOT NULL,
  app_name TEXT NOT NULL, window_title TEXT,
  text TEXT,
  text_hash TEXT NOT NULL,
  category TEXT, category_conf REAL, activity TEXT, activity_conf REAL,
  stuck REAL, distraction REAL, labeled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reads_date ON screen_reads(date, at);
`;

export interface ScreenReadInput { at: number; date: string; appName: string; windowTitle: string | null; text: string | null; textHash: string; }
export interface ScreenReadRow extends ScreenReadInput { id: number; }
export interface ScreenStore {
  insert(r: ScreenReadInput): number;
  last(): ScreenReadRow | null;
  lastWithText(): ScreenReadRow | null;
  purgeTextBefore(ms: number): number;
}

const COLS = 'id, at, date, app_name AS appName, window_title AS windowTitle, text, text_hash AS textHash';

export function createScreenStore(db: Database.Database): ScreenStore {
  const ins = db.prepare('INSERT INTO screen_reads (at, date, app_name, window_title, text, text_hash) VALUES (@at, @date, @appName, @windowTitle, @text, @textHash)');
  const lastQ = db.prepare(`SELECT ${COLS} FROM screen_reads ORDER BY at DESC, id DESC LIMIT 1`);
  const lastTextQ = db.prepare(`SELECT ${COLS} FROM screen_reads WHERE text IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1`);
  const purge = db.prepare('UPDATE screen_reads SET text = NULL, text_hash = \'\' WHERE at < ? AND text IS NOT NULL');
  return {
    insert: (r) => Number(ins.run(r).lastInsertRowid),
    last: () => (lastQ.get() as ScreenReadRow | undefined) ?? null,
    lastWithText: () => (lastTextQ.get() as ScreenReadRow | undefined) ?? null,
    purgeTextBefore: (ms) => purge.run(ms).changes
  };
}

/** "Delete my activity": everything tracked and read; settings, profile and consent are kept. */
export function deleteActivity(db: Database.Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM focus_sessions; DELETE FROM app_events; DELETE FROM activity_samples; DELETE FROM daily_summaries; DELETE FROM screen_reads;');
  })();
}

export interface ExportData {
  exportedAt: number; settings: DaylensSettings; profile: Profile;
  focusSessions: unknown[]; appEvents: unknown[]; activitySamples: unknown[]; screenReads: unknown[];
}

export function exportAll(db: Database.Database, settings: DaylensSettings, profile: Profile, now: number): ExportData {
  const all = (t: string): unknown[] => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
  return {
    exportedAt: now, settings, profile,
    focusSessions: all('focus_sessions'), appEvents: all('app_events'),
    activitySamples: all('activity_samples'), screenReads: all('screen_reads')
  };
}
