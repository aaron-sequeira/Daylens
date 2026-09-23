import type { Repositories } from '@worksight/core';
import type { ActivitySampleRow, FocusSessionRow, ISODate } from '@worksight/core/types';
import { CATEGORIES, categoryForApp, type Category } from '../../shared/categories';
import { atLeast, clip, dayBounds, restPeriods, sessionInterval, shiftDate, subtract, type Interval } from './time';
import { computeHealth, type Health } from './health';

// ponytail: no input for >= 10 min counts as "away" even with a window focused (also drops input-free video).
// Phase 4 refines this with Laya's activity=watching label.
export const AWAY_MS = 10 * 60_000;
const NOT_SCREEN = /^lockapp(\.exe)?$/i; // Windows lock screen
const TIMELINE_JOIN_MS = 60_000;

export interface DayInput { date: ISODate; sessions: FocusSessionRow[]; samples: ActivitySampleRow[]; }
export interface ViewSettings { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number; }
export interface AppTime { appName: string; seconds: number; }
export interface CategoryCard { category: Category; seconds: number; apps: AppTime[]; }
export interface TimelineSegment { start: number; end: number; category: Category; }
export interface DayBar { date: ISODate; seconds: number; byCategory: Record<Category, number>; }
export interface TodayView {
  date: ISODate; now: number; screenSec: number; activeSec: number; goalSec: number; firstSeenAt: number | null;
  cards: CategoryCard[]; timeline: TimelineSegment[]; health: Health; week: DayBar[];
}

interface Piece extends Interval { appName: string; category: Category; }

const sec = (ms: number): number => Math.round(ms / 1000);
const zeroByCategory = (): Record<Category, number> => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

/** On-screen pieces of the day: sessions clipped to the day, minus lock screen and away periods. */
function dayPieces(day: DayInput, now: number): Piece[] {
  const bounds = dayBounds(day.date);
  const away = atLeast(restPeriods(day.samples), AWAY_MS);
  const sorted = [...day.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const pieces: Piece[] = [];
  sorted.forEach((s, i) => {
    if (NOT_SCREEN.test(s.appName.trim())) return;
    const iv = clip(sessionInterval(s, i === sorted.length - 1, now), bounds.start, bounds.end);
    if (!iv) return;
    const category = categoryForApp(s.appName);
    for (const p of subtract(iv, away)) pieces.push({ ...p, appName: s.appName, category });
  });
  return pieces;
}

const totalMs = (pieces: Interval[]): number => pieces.reduce((a, p) => a + (p.end - p.start), 0);

function cardsOf(pieces: Piece[]): CategoryCard[] {
  const byCat = new Map<Category, Map<string, number>>();
  for (const p of pieces) {
    const apps = byCat.get(p.category) ?? new Map<string, number>();
    apps.set(p.appName, (apps.get(p.appName) ?? 0) + (p.end - p.start));
    byCat.set(p.category, apps);
  }
  return [...byCat.entries()]
    .map(([category, apps]) => ({
      category,
      seconds: sec([...apps.values()].reduce((a, b) => a + b, 0)),
      apps: [...apps.entries()].map(([appName, ms]) => ({ appName, seconds: sec(ms) })).sort((a, b) => b.seconds - a.seconds).slice(0, 3)
    }))
    .filter((c) => c.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

function timelineOf(pieces: Piece[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const p of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.category === p.category && p.start - last.end <= TIMELINE_JOIN_MS) last.end = Math.max(last.end, p.end);
    else out.push({ start: p.start, end: p.end, category: p.category });
  }
  return out;
}

function barOf(day: DayInput, now: number): DayBar {
  const byCategory = zeroByCategory();
  const pieces = dayPieces(day, now);
  for (const p of pieces) byCategory[p.category] += p.end - p.start;
  for (const c of CATEGORIES) byCategory[c] = sec(byCategory[c]);
  return { date: day.date, seconds: sec(totalMs(pieces)), byCategory };
}

export function buildTodayView(days: DayInput[], settings: ViewSettings, now: number): TodayView {
  const today = days[days.length - 1];
  const pieces = dayPieces(today, now);
  const screenSec = sec(totalMs(pieces));
  const activeSec = sec(today.samples.filter((s) => s.active === 1).reduce((a, s) => a + (s.bucketEnd - s.bucketStart), 0));
  return {
    date: today.date, now, screenSec, activeSec, goalSec: settings.dailyGoalMin * 60,
    firstSeenAt: pieces.length ? Math.min(...pieces.map((p) => p.start)) : null,
    cards: cardsOf(pieces),
    timeline: timelineOf(pieces),
    health: computeHealth({ samples: today.samples, screenSec, ...settings }),
    week: days.map((d) => barOf(d, now))
  };
}

export function loadTodayView(repo: Repositories, settings: ViewSettings, date: ISODate, now: number): TodayView {
  const days: DayInput[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(date, -i);
    days.push({ date: d, sessions: [...repo.getFocusSessions(shiftDate(d, -1)), ...repo.getFocusSessions(d)], samples: repo.getActivitySamples(d) });
  }
  return buildTodayView(days, settings, now);
}
