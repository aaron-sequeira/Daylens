import type Database from 'better-sqlite3';
import { shiftDate } from '../day/time';
import { cut, str } from './schema';

const toMin = (sec: number): number => Math.round(sec / 60);

/** Monday of the week containing `date` (local). `getDay()` is 0 for Sunday, so the Monday offset is `(getDay() + 6) % 7`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return shiftDate(date, -offset);
}

/** The 7 dates of the week starting at `start` (assumed to already be a Monday): Mon..Sun. */
export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
}

export { canGenerateWeek } from '../../shared/week';

export interface InsightsDay { date: string; screenSec: number; byCategory: Record<string, number>; healthScore: number | null; deepWorkSec: number; }
export interface InsightsNumbers {
  weekStart: string; days: InsightsDay[];
  totals: { screenSec: number; deepWorkSec: number; avgHealth: number | null; activeDays: number };
  prev: { screenSec: number; deepWorkSec: number } | null;
  bestFocusDay: string | null;
  topApps: { app: string; min: number }[];
  nudges: { acted: number; dismissed: number };
}

const ACTIVE_THRESHOLD_SEC = 1800;

function sumDays(days: InsightsDay[]): { screenSec: number; deepWorkSec: number } {
  return days.reduce((a, d) => ({ screenSec: a.screenSec + d.screenSec, deepWorkSec: a.deepWorkSec + d.deepWorkSec }), { screenSec: 0, deepWorkSec: 0 });
}

export function buildInsights(i: { weekStart: string; days: InsightsDay[]; prevDays: InsightsDay[] | null; apps: { app: string; min: number }[][]; nudges: { status: string }[] }): InsightsNumbers {
  const { screenSec, deepWorkSec } = sumDays(i.days);
  const scores = i.days.map((d) => d.healthScore).filter((s): s is number => s !== null);
  const avgHealth = scores.length ? Math.round(scores.reduce((a, s) => a + s, 0) / scores.length) : null;
  const activeDays = i.days.filter((d) => d.screenSec >= ACTIVE_THRESHOLD_SEC).length;
  const prev = i.prevDays ? sumDays(i.prevDays) : null;
  const focusDays = i.days.filter((d) => d.deepWorkSec > 0);
  const bestFocusDay = focusDays.length ? focusDays.reduce((a, d) => (d.deepWorkSec > a.deepWorkSec ? d : a)).date : null;
  const appTotals = new Map<string, { min: number; spell: Map<string, number> }>();
  for (const day of i.apps) for (const a of day) {
    const k = a.app.toLowerCase(), e = appTotals.get(k) ?? { min: 0, spell: new Map<string, number>() };
    e.min += a.min; e.spell.set(a.app, (e.spell.get(a.app) ?? 0) + a.min);
    appTotals.set(k, e);
  }
  const topApps = [...appTotals.values()]
    .map((e) => ({ app: [...e.spell.entries()].sort((a, b) => b[1] - a[1])[0][0], min: e.min }))
    .sort((a, b) => b.min - a.min).slice(0, 8);
  const nudges = { acted: i.nudges.filter((n) => n.status === 'acted').length, dismissed: i.nudges.filter((n) => n.status === 'dismissed').length };
  return { weekStart: i.weekStart, days: i.days, totals: { screenSec, deepWorkSec, avgHealth, activeDays }, prev, bestFocusDay, topApps, nudges };
}

export interface WeekJson { headline: string; summary: string; focusForNextWeek: string; }

export const WEEK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { headline: str(80), summary: str(600), focusForNextWeek: str(200) },
  required: ['headline', 'summary', 'focusForNextWeek']
};

/** Validates the writer's answer: over-long strings are cut, only a missing headline fails. Voice normalisation and
 * numeric grounding (normalizeVoiceText / groundText in ./schema) are applied by generateWeek, not here, so this
 * stays a pure parse of the raw cut values. */
export function parseWeek(raw: unknown): WeekJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const headline = cut(80)(o.headline);
  if (!headline) return null;
  return { headline, summary: cut(600)(o.summary), focusForNextWeek: cut(200)(o.focusForNextWeek) };
}

export interface WeekInput {
  weekStart: string;
  days: { date: string; screenMin: number; deepWorkMin: number; healthScore: number | null; topApps: string[]; topSites: string[]; headline?: string }[];
  totals: { screenMin: number; deepWorkMin: number; activeDays: number; prevScreenMin: number | null };
}

export function buildWeekInput(n: InsightsNumbers, perDay: { topApps: string[]; topSites: string[]; headline?: string }[]): WeekInput {
  return {
    weekStart: n.weekStart,
    days: n.days.map((d, idx) => {
      const p = perDay[idx] ?? { topApps: [], topSites: [] };
      return {
        date: d.date, screenMin: toMin(d.screenSec), deepWorkMin: toMin(d.deepWorkSec), healthScore: d.healthScore,
        topApps: p.topApps, topSites: p.topSites, ...(p.headline ? { headline: p.headline } : {})
      };
    }),
    totals: {
      screenMin: toMin(n.totals.screenSec), deepWorkMin: toMin(n.totals.deepWorkSec), activeDays: n.totals.activeDays,
      prevScreenMin: n.prev ? toMin(n.prev.screenSec) : null
    }
  };
}

/** The cloud gets only the compact input: no locally written headlines (spec §3.3 rule extended to weeks). */
export function weekForCloud(w: WeekInput): WeekInput {
  return { ...w, days: w.days.map(({ headline: _headline, ...d }) => d) };
}

// An hour-rounded mention is only close enough to a value below this to be worth allowing at all (a 5-minute
// value "rounded" to an hour would be nonsense), and even then only within HOUR_ROUND_TOLERANCE of the real value.
const HOUR_ROUND_MIN_VALUE = 120;
const HOUR_ROUND_TOLERANCE = 0.1;

/** Real minute values the writer is allowed to repeat back: every per-day screenMin/deepWorkMin plus the week's
 * totals and (when there was a previous week) its screenMin, plus each value's hour-rounded equivalent (floor,
 * round and ceil of minutes/60, ×60) — but only for values of at least two hours, and only the roundings within
 * 10% of the real value — so a plain-English "about 21 hours" for 1234 min isn't dropped as invented, while a
 * 45-minute value still can't be claimed as "about 1 hour". Used to ground the writer's answer against invented
 * numbers (see groundText in ./schema). */
export function weekAllowedMinutes(w: WeekInput): number[] {
  const base = [
    ...w.days.flatMap((d) => [d.screenMin, d.deepWorkMin]),
    w.totals.screenMin, w.totals.deepWorkMin,
    ...(w.totals.prevScreenMin !== null ? [w.totals.prevScreenMin] : [])
  ];
  const hourRounded = base.filter((v) => v >= HOUR_ROUND_MIN_VALUE).flatMap((v) => {
    const hours = v / 60;
    return [Math.floor(hours), Math.round(hours), Math.ceil(hours)]
      .map((h) => h * 60)
      .filter((rounded) => Math.abs(rounded - v) <= v * HOUR_ROUND_TOLERANCE);
  });
  return [...base, ...hourRounded];
}

const WEEK_SYSTEM = [
  "You are Daylens, a warm, concise coach writing a person's weekly summary of their computer use.",
  'Write in second person ("you"), plain friendly English, no emoji, no markdown.',
  "Always write to the reader as 'you' / 'your'. Never use 'I', 'me', 'my' or 'we'.",
  'Use only the numbers in the input. Do not invent apps, events or numbers; if you mention a number, copy it from the input.',
  "State times exactly as given in the input (as minutes, or as Xh Ym); don't round or convert.",
  'headline: the week in one line.',
  "summary: 3-5 sentences comparing the days in the week, and comparing this week with the previous week's totals when given.",
  'focusForNextWeek: one concrete suggestion for next week.'
].join('\n');

export function weekPrompt(w: WeekInput): { system: string; user: string } {
  return { system: WEEK_SYSTEM, user: JSON.stringify(w) };
}

export const WEEKLY_SQL = `
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_start TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  report_json TEXT, model TEXT, generated_at INTEGER, error TEXT
);
`;

export interface WeeklyRow { weekStart: string; status: 'pending' | 'ready' | 'failed'; report: WeekJson | null; model: string | null; generatedAt: number | null; error: string | null; }
export interface WeeklyStore {
  get(ws: string): WeeklyRow | null;
  setPending(ws: string, now: number): void;
  setReady(ws: string, r: WeekJson, model: string, now: number): void;
  setFailed(ws: string, error: string, now: number): void;
  /** A regenerate failed: keep the row (and its good report), only record why. */
  noteError(ws: string, error: string): void;
  delete(ws: string): void;
  clearPending(now: number): void;
}

type RawWeekly = { week_start: string; status: WeeklyRow['status']; report_json: string | null; model: string | null; generated_at: number | null; error: string | null };

export function createWeeklyStore(db: Database.Database): WeeklyStore {
  const upsert = db.prepare(`INSERT INTO weekly_reports (week_start, status, report_json, model, generated_at, error) VALUES (@ws, @status, @report, @model, @at, @error)
    ON CONFLICT(week_start) DO UPDATE SET status = excluded.status, report_json = excluded.report_json, model = excluded.model, generated_at = excluded.generated_at, error = excluded.error`);
  const one = db.prepare('SELECT * FROM weekly_reports WHERE week_start = ?');
  const stale = db.prepare("UPDATE weekly_reports SET status = 'failed', error = 'interrupted', generated_at = ? WHERE status = 'pending'");
  const note = db.prepare('UPDATE weekly_reports SET error = ? WHERE week_start = ?');
  const drop = db.prepare('DELETE FROM weekly_reports WHERE week_start = ?');
  const put = (ws: string, status: WeeklyRow['status'], report: WeekJson | null, model: string | null, at: number, error: string | null): void => {
    upsert.run({ ws, status, report: report ? JSON.stringify(report) : null, model, at, error });
  };
  return {
    get(ws) {
      const r = one.get(ws) as RawWeekly | undefined;
      if (!r) return null;
      let report: WeekJson | null = null;
      let status: WeeklyRow['status'] = r.status;
      let error = r.error;
      try { report = r.report_json ? JSON.parse(r.report_json) as WeekJson : null; } catch {
        if (r.status === 'ready') { status = 'failed'; error = 'corrupt report'; }
      }
      return { weekStart: r.week_start, status, report, model: r.model, generatedAt: r.generated_at, error };
    },
    setPending: (ws, now) => put(ws, 'pending', null, null, now, null),
    setReady: (ws, r, model, now) => put(ws, 'ready', r, model, now, null),
    setFailed: (ws, error, now) => put(ws, 'failed', null, null, now, error),
    noteError: (ws, error) => { note.run(error, ws); },
    delete: (ws) => { drop.run(ws); },
    clearPending: (now) => { stale.run(now); }
  };
}
