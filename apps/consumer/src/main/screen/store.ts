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
CREATE INDEX IF NOT EXISTS idx_reads_at ON screen_reads(at);
-- The labelling scheduler scans for pending reads every minute; keep that off a full-table scan.
CREATE INDEX IF NOT EXISTS idx_reads_unlabelled ON screen_reads(at) WHERE labeled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reads_labeled ON screen_reads(labeled_at);
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
  // Also blanks the hash on an already-purged dup row (text NULL, hash still set): otherwise old free
  // pages/WAL frames keep the hash of text that should have aged out along with everything else.
  const purge = db.prepare('UPDATE screen_reads SET text = NULL, text_hash = \'\' WHERE at < ? AND (text IS NOT NULL OR text_hash <> \'\')');
  return {
    insert: (r) => Number(ins.run(r).lastInsertRowid),
    last: () => (lastQ.get() as ScreenReadRow | undefined) ?? null,
    lastWithText: () => (lastTextQ.get() as ScreenReadRow | undefined) ?? null,
    purgeTextBefore: (ms) => purge.run(ms).changes
  };
}

/**
 * Forces purged/deleted text out of the WAL and into the main file, then truncates the WAL.
 * With `secure_delete = ON` (set once at startup) this actually overwrites the freed pages instead of
 * leaving old text sitting in free pages or old WAL frames. Call after deleteActivity and after any
 * retention run that changed rows.
 */
export function checkpoint(db: Database.Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}

const hasTable = (db: Database.Database, t: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

/** "Delete my activity": everything tracked and read; settings, profile and consent are kept. */
export function deleteActivity(db: Database.Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM focus_sessions; DELETE FROM app_events; DELETE FROM activity_samples; DELETE FROM daily_summaries; DELETE FROM screen_reads;');
    if (hasTable(db, 'nudges')) db.exec('DELETE FROM nudges; DELETE FROM breaks;');
  })();
}

export interface ExportData {
  exportedAt: number; settings: DaylensSettings; profile: Profile;
  focusSessions: unknown[]; appEvents: unknown[]; activitySamples: unknown[]; screenReads: unknown[];
  nudges: unknown[]; breaks: unknown[];
}

export function exportAll(db: Database.Database, settings: DaylensSettings, profile: Profile, now: number): ExportData {
  const all = (t: string): unknown[] => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
  return {
    exportedAt: now, settings, profile,
    focusSessions: all('focus_sessions'), appEvents: all('app_events'),
    activitySamples: all('activity_samples'), screenReads: all('screen_reads'),
    nudges: hasTable(db, 'nudges') ? all('nudges') : [], breaks: hasTable(db, 'breaks') ? all('breaks') : []
  };
}
