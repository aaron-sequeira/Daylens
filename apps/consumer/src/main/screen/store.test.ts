import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, createRepositories } from '@worksight/core';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_PROFILE } from '../../shared/profileOptions';
import { SCREEN_SCHEMA, createScreenStore, checkpoint, deleteActivity, exportAll, type ScreenReadInput } from './store';
import { COACH_SCHEMA, createCoachStore } from '../coach/store';
import { REPORT_SQL, createReportStore } from '../report/store';
import { REPORT_FTS_SQL, createReportSearch } from '../report/search';
import { WEEKLY_SQL, createWeeklyStore } from '../report/week';

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
  it('also blanks the hash on an already-purged dup row (text NULL, hash still set)', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, null, 'stale-hash'));
    s.insert(read(5000, 'new'));
    expect(s.purgeTextBefore(3000)).toBe(1);
    const row = db.prepare('SELECT text_hash AS textHash FROM screen_reads WHERE at = 1000').get();
    expect(row).toMatchObject({ textHash: '' });
  });
  it('does not re-count rows that are already fully purged', () => {
    const s = createScreenStore(db);
    s.insert(read(1000, null, ''));
    expect(s.purgeTextBefore(3000)).toBe(0);
  });
});

describe('checkpoint', () => {
  it('runs without throwing (WAL checkpoint/truncate is a no-op safety net on an in-memory db)', () => {
    expect(() => checkpoint(db)).not.toThrow();
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

  it('also works, and does nothing to coach tables, on a db without them', () => {
    createScreenStore(db).insert(read(1000, 'x'));
    expect(() => deleteActivity(db)).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM screen_reads').get()).toEqual({ n: 0 });
  });

  it('empties nudges and breaks too when the coach tables exist', () => {
    db.exec(COACH_SCHEMA);
    const coach = createCoachStore(db);
    coach.record({ at: 1000, date: '2026-09-24', kind: 'health', ruleId: 'eye_break', key: 'k', title: 't', body: 'b', status: 'shown' });
    coach.recordBreak({ at: 1000, date: '2026-09-24', kind: 'eye', seconds: 20, completed: true });
    createScreenStore(db).insert(read(1000, 'x'));
    deleteActivity(db);
    expect(db.prepare('SELECT count(*) AS n FROM nudges').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM breaks').get()).toEqual({ n: 0 });
  });

  it('empties daily_reports and plan_items when the report tables exist', () => {
    db.exec(REPORT_SQL);
    const report = createReportStore(db);
    report.setPending('2026-09-24', 1);
    report.setReady('2026-09-24', { headline: 'H', story: 'S', wins: [], habits: [], doBetter: [], plan: [], advice: 'A' }, 'model', 2);
    const item = { kind: 'break_interval' as const, text: 'Breaks', payload: { minutes: 40 } };
    report.tick('2026-09-24', item, true);
    deleteActivity(db);
    expect(db.prepare('SELECT count(*) AS n FROM daily_reports').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM plan_items').get()).toEqual({ n: 0 });
  });

  it('clears report_fts when it exists', () => {
    db.exec(REPORT_FTS_SQL);
    const search = createReportSearch(db);
    search.upsert('2026-09-24', 'figma');
    expect(search.count()).toBe(1);
    deleteActivity(db);
    expect(search.count()).toBe(0);
  });

  it('empties weekly_reports when it exists', () => {
    db.exec(WEEKLY_SQL);
    const weekly = createWeeklyStore(db);
    weekly.setReady('2026-09-28', { headline: 'H', summary: 'S', focusForNextWeek: 'F' }, 'model', 1);
    deleteActivity(db);
    expect(db.prepare('SELECT count(*) AS n FROM weekly_reports').get()).toEqual({ n: 0 });
  });
});

describe('exportAll', () => {
  it('exports every table plus settings and profile, with empty optional tables when they do not exist', () => {
    createScreenStore(db).insert(read(1000, 'x'));
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(Object.keys(out).sort()).toEqual(['activitySamples', 'appEvents', 'breaks', 'dailyReports', 'exportedAt', 'focusSessions', 'nudges', 'planItems', 'profile', 'screenReads', 'settings', 'weeklyReports']);
    expect(out.exportedAt).toBe(42);
    expect(out.screenReads).toHaveLength(1);
    expect(out.nudges).toEqual([]);
    expect(out.breaks).toEqual([]);
    expect(out.dailyReports).toEqual([]);
    expect(out.planItems).toEqual([]);
    expect(out.weeklyReports).toEqual([]);
  });

  it('includes nudges and breaks when the coach tables exist', () => {
    db.exec(COACH_SCHEMA);
    const coach = createCoachStore(db);
    coach.record({ at: 1000, date: '2026-09-24', kind: 'health', ruleId: 'eye_break', key: 'k', title: 't', body: 'b', status: 'shown' });
    coach.recordBreak({ at: 1000, date: '2026-09-24', kind: 'eye', seconds: 20, completed: true });
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(out.nudges).toHaveLength(1);
    expect(out.breaks).toHaveLength(1);
  });

  it('includes daily_reports and plan_items when the report tables exist', () => {
    db.exec(REPORT_SQL);
    const report = createReportStore(db);
    report.setReady('2026-09-24', { headline: 'H', story: 'S', wins: [], habits: [], doBetter: [], plan: [], advice: 'A' }, 'model', 1);
    const item = { kind: 'break_interval' as const, text: 'Breaks', payload: { minutes: 40 } };
    report.tick('2026-09-24', item, true);
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(out.dailyReports).toHaveLength(1);
    expect(out.planItems).toHaveLength(1);
  });

  it('includes weekly_reports when the weekly table exists', () => {
    db.exec(WEEKLY_SQL);
    const weekly = createWeeklyStore(db);
    weekly.setReady('2026-09-28', { headline: 'H', summary: 'S', focusForNextWeek: 'F' }, 'model', 1);
    const out = exportAll(db, DEFAULT_SETTINGS, DEFAULT_PROFILE, 42);
    expect(out.weeklyReports).toHaveLength(1);
  });
});
