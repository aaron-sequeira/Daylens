import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, createRepositories } from '@worksight/core';
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { buildTodayView, loadTodayView, type DayInput } from './today';

const MIN = 60_000;
const DATE = '2026-09-23';
const T = (h: number, m = 0, day = 23): number => new Date(2026, 8, day, h, m).getTime();
const settings = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };
let nextId = 1;
const session = (appName: string, start: number, end: number | null, date = DATE): FocusSessionRow => ({
  id: nextId++, appName, appPath: null, windowTitle: null, pid: 1, startedAt: start, endedAt: end,
  durationSec: end === null ? null : Math.round((end - start) / 1000), date
});
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({
    id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: null, date: DATE
  }));
const emptyWeek = (): DayInput[] => ['17', '18', '19', '20', '21', '22'].map((d) => ({ date: `2026-09-${d}`, sessions: [], samples: [], labels: [] }));
const view = (today: Omit<DayInput, 'date'>, now = T(18)) => buildTodayView([...emptyWeek(), { date: DATE, ...today, labels: today.labels ?? [] }], settings, now);

describe('buildTodayView', () => {
  it('renders an empty first day as zeros with no NaN', () => {
    const v = view({ sessions: [], samples: [] });
    expect(v).toMatchObject({ screenSec: 0, activeSec: 0, goalSec: 420 * 60, firstSeenAt: null, cards: [], timeline: [] });
    expect(v.health.score).toBe(100);
    expect(v.week).toHaveLength(7);
    expect(v.week.every((d) => d.seconds === 0 && !Number.isNaN(d.seconds))).toBe(true);
  });

  it('groups screen time into category cards with top apps, sorted by time', () => {
    const v = view({
      sessions: [session('Visual Studio Code', T(9), T(11)), session('Discord', T(11), T(11, 30)), session('Figma', T(11, 30), T(12))],
      samples: run(T(9), 180, 1)
    });
    expect(v.screenSec).toBe(3 * 3600);
    expect(v.activeSec).toBe(3 * 3600);
    expect(v.cards.map((c) => [c.category, c.seconds])).toEqual([['work', 9000], ['social', 1800]]);
    expect(v.cards[0].apps).toEqual([{ appName: 'Visual Studio Code', seconds: 7200 }, { appName: 'Figma', seconds: 1800 }]);
    expect(v.firstSeenAt).toBe(T(9));
  });

  it('counts the open latest session up to now, but not an older open session', () => {
    const v = view({ sessions: [session('Figma', T(8), null), session('Visual Studio Code', T(9), null)], samples: run(T(8), 90, 1) }, T(9, 30));
    expect(v.screenSec).toBe(30 * 60);
  });

  it('includes the part after midnight of a session that started yesterday', () => {
    const v = view({ sessions: [session('Visual Studio Code', T(23, 50, 22), T(0, 20), '2026-09-22')], samples: run(T(0), 20, 1) });
    expect(v.screenSec).toBe(20 * 60);
    expect(v.timeline).toEqual([{ start: T(0), end: T(0, 20), category: 'work' }]);
  });

  it('removes away time (no input for >= 10 min) but keeps short pauses', () => {
    const samples = [...run(T(10), 20, 1), ...run(T(10, 20), 20, 0), ...run(T(10, 40), 15, 1), ...run(T(10, 55), 5, 0)];
    const v = view({ sessions: [session('Google Chrome', T(10), T(11))], samples });
    expect(v.screenSec).toBe(40 * 60);
    expect(v.timeline).toEqual([{ start: T(10), end: T(10, 20), category: 'other' }, { start: T(10, 40), end: T(11), category: 'other' }]);
  });

  it('never counts the lock screen', () => {
    const v = view({ sessions: [session('LockApp.exe', T(12), T(13)), session('Slack', T(13), T(13, 10))], samples: run(T(12), 70, 1) });
    expect(v.screenSec).toBe(10 * 60);
    expect(v.cards.map((c) => c.category)).toEqual(['communication']);
  });

  it('merges adjacent same-category pieces on the timeline', () => {
    const v = view({ sessions: [session('Visual Studio Code', T(9), T(9, 30)), session('Figma', T(9, 30), T(10)), session('Discord', T(10), T(10, 5))], samples: run(T(9), 65, 1) });
    expect(v.timeline).toEqual([{ start: T(9), end: T(10), category: 'work' }, { start: T(10), end: T(10, 5), category: 'social' }]);
  });

  it('builds weekly bars per category, oldest first', () => {
    const days = emptyWeek();
    days[0] = { date: '2026-09-17', sessions: [session('Spotify', T(10, 0, 17), T(11, 0, 17), '2026-09-17')], samples: [] };
    const v = buildTodayView([...days, { date: DATE, sessions: [], samples: [] }], settings, T(18));
    expect(v.week[0]).toMatchObject({ date: '2026-09-17', seconds: 3600 });
    expect(v.week[0].byCategory.entertainment).toBe(3600);
    expect(v.week[6].date).toBe(DATE);
  });

  it('does not count a crash-leftover open session on a past day as open (only the globally-latest session can be)', () => {
    const days = emptyWeek();
    days[0] = { date: '2026-09-17', sessions: [session('Spotify', T(10, 0, 17), null, '2026-09-17')], samples: [] };
    const v = buildTodayView([...days, { date: DATE, sessions: [], samples: [] }], settings, T(18));
    expect(v.week[0].seconds).toBe(0);
  });

  it('does not count screen time before the first sample of the day (rest before first sample is invisible to restPeriods)', () => {
    const v = view({ sessions: [session('Visual Studio Code', T(23, 50, 22), T(9), '2026-09-22')], samples: run(T(8), 60, 1) });
    expect(v.screenSec).toBe(3600);
  });

  it('does not count sleep as screen time (lid closed 22:59 with a session open, opened 07:00)', () => {
    const lidClosed = T(22, 59, 22);
    // what the tracker wrote on wake: one "active" bucket spanning the whole night, dated today
    const overnight = { ...run(lidClosed, 1, 1)[0], bucketEnd: T(7) };
    const days = emptyWeek();
    const vscode = session('Visual Studio Code', T(22, 30, 22), null, '2026-09-22');
    days[5] = { date: '2026-09-22', sessions: [vscode], samples: run(T(22, 30, 22), 29, 1).map((x) => ({ ...x, date: '2026-09-22' })) };
    const v = buildTodayView([...days, { date: DATE, sessions: [vscode], samples: [overnight, ...run(T(7), 5, 1)] }], settings, T(7, 5));
    expect(v.screenSec).toBe(5 * 60);
    expect(v.activeSec).toBe(5 * 60);
    expect(v.health.score).toBe(100);
    expect(v.week[5].seconds).toBe(29 * 60); // yesterday: 22:30 -> 22:59, not up to midnight
  });

  it('uses the most frequent confident Laya category for a session piece', () => {
    const v = view({
      sessions: [session('Google Chrome', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [
        { at: T(9, 5), appName: 'Google Chrome', category: 'social', conf: 0.9 },
        { at: T(9, 20), appName: 'Google Chrome', category: 'social', conf: 0.9 },
        { at: T(9, 40), appName: 'Google Chrome', category: 'learning', conf: 0.9 },
        { at: T(9, 50), appName: 'Discord', category: 'entertainment', conf: 0.9 }
      ]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['social']);
    expect(v.timeline.map((s) => s.category)).toEqual(['social']);
  });

  it('falls back to the app-name rule without labels in the piece', () => {
    const v = view({
      sessions: [session('Microsoft Teams', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [{ at: T(11), appName: 'Microsoft Teams', category: 'social', conf: 0.9 }]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['communication']);
  });

  it('counts an unsure read on an unknown app as Laya\'s own guess', () => {
    const v = view({
      sessions: [session('Google Chrome', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [{ at: T(9, 5), appName: 'Google Chrome', category: 'entertainment', conf: 0.2 }]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['entertainment']);
  });

  it('counts an unsure read on a known app (Teams) as the app rule\'s category, even though Laya guessed differently', () => {
    const v = view({
      sessions: [session('Microsoft Teams', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [{ at: T(9, 5), appName: 'Microsoft Teams', category: 'entertainment', conf: 0.2 }]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['communication']);
  });

  it('keeps a confident Laya choice on a known app (Teams) instead of the app rule', () => {
    const v = view({
      sessions: [session('Microsoft Teams', T(9), T(10))],
      samples: run(T(9), 60, 1),
      labels: [{ at: T(9, 5), appName: 'Microsoft Teams', category: 'entertainment', conf: 0.9 }]
    });
    expect(v.cards.map((c) => c.category)).toEqual(['entertainment']);
  });
});

describe('loadTodayView', () => {
  it('reads 7 days (plus the day before each) from the repositories', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const repo = createRepositories(db);
    const id = repo.startFocusSession({ appName: 'Visual Studio Code', appPath: null, windowTitle: 'a.ts', pid: 1, startedAt: T(9), date: DATE });
    repo.finalizeFocusSession(id, T(10));
    for (const { id: _id, ...s } of run(T(9), 60, 1)) repo.insertActivitySample(s);
    const v = loadTodayView(repo, settings, DATE, T(18));
    expect(v.screenSec).toBe(3600);
    expect(v.week.map((d) => d.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', DATE]);
  });
});
