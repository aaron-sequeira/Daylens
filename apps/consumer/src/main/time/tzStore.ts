import type Database from 'better-sqlite3';
import type { TzChange } from './zone';

export const TZ_SQL = `
CREATE TABLE IF NOT EXISTS tz_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  from_name TEXT NOT NULL, to_name TEXT NOT NULL, from_offset INTEGER NOT NULL, to_offset INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tz_at ON tz_changes(at);
`;
/** A zone change is activity history (where you travelled): kept only with consent and while tracking isn't paused.
 * The zone itself is always followed. */
export const mayRecordTz = (s: { consentGranted: boolean; trackingPaused: boolean }): boolean => s.consentGranted && !s.trackingPaused;
const COLS ='at, from_name AS fromName, to_name AS toName, from_offset AS fromOffset, to_offset AS toOffset';

export function createTzStore(db: Database.Database) {
  const ins = db.prepare('INSERT INTO tz_changes (at, from_name, to_name, from_offset, to_offset) VALUES (@at, @fromName, @toName, @fromOffset, @toOffset)');
  const since = db.prepare(`SELECT ${COLS} FROM tz_changes WHERE at >= ? ORDER BY at, id`);
  const latest = db.prepare(`SELECT ${COLS} FROM tz_changes ORDER BY at DESC, id DESC LIMIT 1`);
  return {
    record: (c: TzChange): void => { ins.run(c); },
    since: (ms: number): TzChange[] => since.all(ms) as TzChange[],
    latest: (): TzChange | null => (latest.get() as TzChange | undefined) ?? null,
    clear: (): void => { db.exec('DELETE FROM tz_changes'); }
  };
}
