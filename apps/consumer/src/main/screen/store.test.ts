import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, createRepositories } from '@worksight/core';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import { SCREEN_SCHEMA, createScreenStore, deleteActivity, exportAll, type ScreenReadInput } from './store';

let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCHEMA_SQL); db.exec(SCREEN_SCHEMA); });
const read = (at: number, text: string | null, hash = 'h' + at): ScreenReadInput =>
  ({ at, date: '2026-09-24', appName: 'Code', windowTitle: 'a.ts', text, textHash: hash });

describe('screen store', () => {
  it('schema is idempotent', () => { expect(() => db.exec(SCREEN_SCHEMA)).not.toThrow(); });
  it('inserts and returns the latest read, and the latest read that has text', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, 'first'));
    s.insert(read(2000, null, 'h1000'));
    expect(s.last()).toMatchObject({ at: 2000, text: null, textHash: 'h1000', appName: 'Code', windowTitle: 'a.ts' });
    expect(s.lastWithText()).toMatchObject({ at: 1000, text: 'first' });
  });
  it('returns null when empty', () => {
    const s = createScreenStore(db);
    expect(s.last()).toBeNull();
    expect(s.lastWithText()).toBeNull();
  });
  it('purges text older than a cutoff but keeps the rows, and blanks the hash', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, 'old'));
    s.insert(read(5000, 'new'));
    expect(s.purgeTextBefore(3000)).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM screen_reads').get()).toEqual({ n: 2 });
    expect(s.lastWithText()).toMatchObject({ text: 'new' });
    const purged = db.prepare('SELECT text_hash AS textHash FROM screen_reads WHERE at = 1000').get();
    expect(purged).toMatchObject({ textHash: '' });
  });
});

describe('deleteActivity', () => {
  it('removes activity and screen reads but keeps settings', () => {
    const repo = createRepositories(db);
    const id = repo.startFocusSession({ appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: 1, date: '2026-09-24' });
    repo.finalizeFocusSession(id, 60_000);
    repo.insertAppEvent({ appName: 'Code', appPath: null, pid: 1, type: 'opened', at: 1, date: '2026-09-24' });
    repo.insertActivitySample({ bucketStart: 0, bucketEnd: 60_000, mouseMoves: 1, mouseDistancePx: 1, clicks: 0, scrolls: 0, keyEvents: 0, active: 1, appName: 'Code', date: '2026-09-24' });
    createScreenStore(db).insert(read(1000, 'x'));
    db.prepare("INSERT INTO settings (key, value) VALUES ('consentGranted', 'true')").run();
    deleteActivity(db);
    for (const t of ['focus_sessions', 'app_events', 'activity_samples', 'daily_summaries', 'screen_reads']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 1 });
  });
});

describe('exportAll', () => {
  it('exports every table plus settings and profile', () => {
    createScreenStore(db).insert(read(1000, 'x'));
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(Object.keys(out).sort()).toEqual(['activitySamples', 'appEvents', 'exportedAt', 'focusSessions', 'profile', 'screenReads', 'settings']);
    expect(out.exportedAt).toBe(42);
    expect(out.screenReads).toHaveLength(1);
  });
});
