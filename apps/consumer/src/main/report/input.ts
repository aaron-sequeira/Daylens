import type { Health } from '../day/health';
import type { TodayView } from '../day/today';
import { displayAppName } from '../../shared/categories';
import { deepWorkSec, type Episode } from './episodes';
import type { ReportCandidate } from './candidates';
import type { DayDetail } from './detail';

export const INPUT_EPISODES = 40;
// Context budget for the local writer (6144 tokens, 1400 of them for the answer).
const SAMPLE_EPISODES = 8;
const SAMPLE_BUDGET = 2500;
const TITLE_CHARS = 80;
// What's left of the context for the input after the system prompt + schema (~2 000 chars) and the answer. Qwen3
// tokenizes digits one per token, so this JSON averages ~2.9 chars/token: 10 500 chars ≈ 3 600 tokens.
export const INPUT_CHARS = 10_500;
export interface ReportStats { date: string; screenSec: number; activeSec: number; goalSec: number; deepWorkSec: number; switches: number;
  health: Health; topApps: { appName: string; seconds: number }[]; categories: { category: string; seconds: number }[]; weekAvgSec: number; }
/** `start` + `minutes` (no `end`: it's derivable, and every digit costs a token). */
export interface WriterEpisode { id: string; start: string; minutes: number; app: string; category: string; activity: string | null;
  titles: string[]; samples: string[]; stuck: number; distraction: number; }
/** Human-readable numbers for the writer, in minutes (never raw seconds/health internals): the only numbers it
 * should ever repeat back, besides episode minutes and the numbers already spelled out in candidate text. */
export interface ReportFacts { screenMin: number; activeMin: number; deepWorkMin: number; longestStretchMin: number;
  breaks: number; expectedBreaks: number; lateNight: boolean; goalMin: number; weekAvgMin: number;
  topApps: { app: string; min: number }[]; switches: number; }
/** One of the 7 days before the report date: the writer's short memory, for trends. */
export interface WeekDay { date: string; screenMin: number; topApps: string[]; topSites: string[]; headline?: string; }
export interface WriterWeek { days: WeekDay[]; avgScreenMin: number; }
export interface ReportInput { date: string; facts: ReportFacts; episodes: WriterEpisode[]; candidates: ReportCandidate[];
  goals: { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }; detail: DayDetail; week: WriterWeek; }

const DETAIL_CHARS = 60;
const cut = (s: string): string => s.slice(0, DETAIL_CHARS);
const EMPTY_DETAIL: DayDetail = { apps: [], sites: [], videos: [], games: [], learning: [] };

/** The writer's copy of "Your day in detail": apps 8, sites 8 with ≤ 2 pages each, videos 6, games 5, learning 5, text ≤ 60 chars. */
export function compactDetail(d: DayDetail): DayDetail {
  return {
    apps: d.apps.slice(0, 8).map((a) => ({ app: cut(a.app), min: a.min })),
    sites: d.sites.slice(0, 8).map((s) => ({ site: cut(s.site), min: s.min, pages: s.pages.slice(0, 2).map(cut) })),
    videos: d.videos.slice(0, 6).map((v) => ({ title: cut(v.title), site: cut(v.site), min: v.min })),
    games: d.games.slice(0, 5).map((g) => ({ name: cut(g.name), min: g.min })),
    learning: d.learning.slice(0, 5).map((l) => ({ title: cut(l.title), where: cut(l.where), min: l.min }))
  };
}

/** The 7-day memory from each earlier day's screen time, detail and stored headline. Days without screen time are left
 * out; the average is over the days listed. */
export function buildWeek(days: { date: string; screenSec: number; detail: DayDetail; headline?: string }[]): WriterWeek {
  const listed = days.filter((d) => toMin(d.screenSec) > 0).map((d): WeekDay => ({
    date: d.date, screenMin: toMin(d.screenSec), topApps: d.detail.apps.slice(0, 3).map((a) => cut(a.app)),
    topSites: d.detail.sites.slice(0, 3).map((s) => cut(s.site)), ...(d.headline ? { headline: d.headline } : {})
  }));
  return { days: listed, avgScreenMin: listed.length ? Math.round(listed.reduce((a, d) => a + d.screenMin, 0) / listed.length) : 0 };
}

const hhmm = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const r1 = (x: number): number => Math.round(x * 10) / 10;
const toMin = (sec: number): number => Math.round(sec / 60);

export function buildFacts(stats: ReportStats): ReportFacts {
  return {
    screenMin: toMin(stats.screenSec), activeMin: Math.min(toMin(stats.activeSec), toMin(stats.screenSec)),
    deepWorkMin: toMin(stats.deepWorkSec), longestStretchMin: toMin(stats.health.longestStretchSec),
    breaks: stats.health.breaks, expectedBreaks: stats.health.expectedBreaks, lateNight: stats.health.lateNight,
    goalMin: toMin(stats.goalSec), weekAvgMin: toMin(stats.weekAvgSec), switches: stats.switches,
    topApps: stats.topApps.map((a) => ({ app: displayAppName(a.appName), min: toMin(a.seconds) }))
  };
}

export function buildStats(view: TodayView, episodes: Episode[], switches: number): ReportStats {
  const prior = view.week.filter((d) => d.date !== view.date);
  return {
    // ponytail: the tracker can log more active samples than open screen time on a bad clock; never claim over 100%.
    date: view.date, screenSec: view.screenSec, activeSec: Math.min(view.activeSec, view.screenSec), goalSec: view.goalSec, deepWorkSec: deepWorkSec(episodes), switches,
    health: view.health, topApps: view.apps.slice(0, 5), categories: view.cards.map((c) => ({ category: c.category, seconds: c.seconds })),
    weekAvgSec: prior.length ? prior.reduce((a, d) => a + d.seconds, 0) / prior.length : 0
  };
}

const dur = (e: Episode): number => e.end - e.start;
const isStuck = (e: Episode): boolean => e.avgStuck >= 1 || e.stuckReads > 0;
/** Most important first: stuck episodes (most stuck first), then the longest. */
const priority = (a: Episode, b: Episode): number =>
  Number(isStuck(b)) - Number(isStuck(a)) || b.avgStuck - a.avgStuck || b.stuckReads - a.stuckReads || dur(b) - dur(a);

/** Samples share SAMPLE_BUDGET characters across the input. Candidates' short samples (the grounding for doBetter)
 * are served first; then only stuck episodes and the SAMPLE_EPISODES longest may keep theirs, most stuck then longest
 * first, so the shortest / least stuck lose theirs first. A stuck candidate's sample is the start of its episode's
 * first sample: that shared text is counted once. */
function budgetSamples(longest: Episode[], candidates: ReportCandidate[]): { samples: Map<string, string[]>; candidates: ReportCandidate[] } {
  let left = SAMPLE_BUDGET;
  const take = (n: number): boolean => (n <= left ? ((left -= n), true) : false);
  const counted = new Map<string, string>(); // episode id → its candidate's sample, already paid for
  const cands = candidates.map(({ sample, ...c }) => {
    if (!sample || !take(sample.length)) return c;
    if (c.kind === 'stuck') counted.set(c.id.slice('stuck:'.length), sample);
    return { ...c, sample };
  });
  const top = new Set(longest.slice(0, SAMPLE_EPISODES).map((e) => e.id));
  const samples = new Map<string, string[]>();
  for (const e of longest.filter((x) => isStuck(x) || top.has(x.id)).sort(priority)) {
    let paid = counted.get(e.id);
    samples.set(e.id, e.samples.filter((s) => {
      const shared = paid !== undefined && s.startsWith(paid) ? paid.length : 0;
      if (!take(s.length - shared)) return false;
      if (shared) paid = undefined; // only once
      return true;
    }));
  }
  return { samples, candidates: cands };
}

/** A hard cap: while the input is over INPUT_CHARS, give way in this order: episodes' samples (least stuck first); then
 * third titles, second, first (least stuck first); then whole episodes, shortest first; then week headlines, then week
 * topSites (oldest day first); then detail pages (smallest site first). Facts, goals and candidates (already capped by
 * buildCandidates) are never cut on a real day; only a pathological input reaches the last resort of dropping
 * candidates' samples, then candidates from the end. A normal day keeps everything. */
function fitInput(input: ReportInput, order: string[]): void {
  const over = (): boolean => JSON.stringify(input).length > INPUT_CHARS;
  const byId = new Map(input.episodes.map((e) => [e.id, e]));
  const leastFirst = [...order].reverse().map((id) => byId.get(id)).filter((e): e is WriterEpisode => !!e);
  for (const e of leastFirst) {
    if (!over()) return;
    e.samples = [];
  }
  for (let keep = 2; keep >= 0; keep--) {
    for (const e of leastFirst) {
      if (!over()) return;
      if (e.titles.length > keep) e.titles = e.titles.slice(0, keep);
    }
  }
  for (const e of [...input.episodes].sort((a, b) => a.minutes - b.minutes)) {
    if (!over()) return;
    input.episodes = input.episodes.filter((x) => x !== e);
  }
  const oldestFirst = [...input.week.days].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of oldestFirst) {
    if (!over()) return;
    delete d.headline;
  }
  for (const d of oldestFirst) {
    if (!over()) return;
    d.topSites = [];
  }
  for (const s of [...input.detail.sites].reverse()) {
    if (!over()) return;
    s.pages = [];
  }
  for (let k = input.candidates.length - 1; k >= 0; k--) {
    if (!over()) return;
    const { sample: _sample, ...c } = input.candidates[k];
    input.candidates[k] = c;
  }
  while (over() && input.candidates.length) input.candidates.pop();
}

export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'];
  detail?: DayDetail; week?: WriterWeek }): ReportInput {
  const longest = [...i.episodes].sort((a, b) => dur(b) - dur(a)).slice(0, INPUT_EPISODES);
  const { samples, candidates } = budgetSamples(longest, i.candidates);
  const week = i.week ?? { days: [], avgScreenMin: 0 };
  const input: ReportInput = {
    date: i.stats.date, facts: buildFacts(i.stats), candidates, goals: i.goals,
    detail: compactDetail(i.detail ?? EMPTY_DETAIL), week: { ...week, days: week.days.map((d) => ({ ...d, topApps: [...d.topApps], topSites: [...d.topSites] })) },
    episodes: [...longest].sort((a, b) => a.start - b.start).map((e) => ({ id: e.id, start: hhmm(e.start),
      minutes: Math.round(dur(e) / 60_000), app: e.app, category: e.category, activity: e.activity, titles: e.titles.map((t) => t.slice(0, TITLE_CHARS)),
      samples: samples.get(e.id) ?? [], stuck: r1(e.avgStuck), distraction: r1(e.avgDistraction) }))
  };
  fitInput(input, [...longest].sort(priority).map((e) => e.id));
  return input;
}

/** The cloud gets only the compact input: no screen-text samples, from episodes or candidates (spec §3.3). Detail and
 * week (page, video and game titles, never screen text) are kept: the user approved sending them. */
export function forCloud(input: ReportInput): ReportInput {
  return {
    ...input,
    episodes: input.episodes.map((e) => ({ ...e, samples: [] })),
    candidates: input.candidates.map(({ sample: _sample, ...c }) => c)
  };
}

const numbersIn = (text: string): number[] => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));

/** Real minute values the writer is allowed to repeat back: from `facts`, each episode's minutes, the detail and week
 * minutes, and any number already spelled out in a candidate's text (those came from code, not the model). Used to
 * ground the writer's answer against invented numbers (see `groundNumbers` in ./schema). */
export function allowedMinutes(input: ReportInput): number[] {
  const f = input.facts, d = input.detail;
  return [
    f.screenMin, f.activeMin, f.deepWorkMin, f.longestStretchMin, f.breaks, f.expectedBreaks, f.goalMin, f.weekAvgMin, f.switches,
    ...f.topApps.map((a) => a.min), ...input.episodes.map((e) => e.minutes), ...input.candidates.flatMap((c) => numbersIn(c.text)),
    ...[...d.apps, ...d.sites, ...d.videos, ...d.games, ...d.learning].map((x) => x.min),
    ...input.week.days.map((w) => w.screenMin), input.week.avgScreenMin
  ];
}

const SYSTEM = [
  "You are Daylens, a warm, concise coach writing a person's end-of-day report about their computer use.",
  'Write in second person ("you"), plain friendly English, no emoji, no markdown.',
  "Always write to the reader as 'you' / 'your'. Never use 'I', 'me', 'my' or 'we'.",
  'Use only the facts in the input. Do not invent apps, events, problems or numbers; if you mention a number, copy it from the input.',
  'Only mention durations or counts that appear in facts, episodes, detail or week; if deepWorkMin is 0, do not claim deep work.',
  'Use detail to be specific about what the person did (apps, sites, videos, games, learning). Use week to notice trends and changes '
    + 'versus recent days (e.g. more/less screen time, a recurring late-night site). Never invent items not in detail/episodes.',
  'headline: one short line capturing the day. story: 3-5 sentences on how the day went, in time order.',
  'wins: up to 3 genuine positives supported by the facts. habits: up to 3 patterns to improve, never praise, kind not judgmental.',
  'doBetter: up to 4 items; each MUST set candidateId to one of the ids in "candidates" and give what happened and a concrete better approach.',
  'plan: up to 4 suggestions for tomorrow, each with kind focus_block {start "HH:MM", minutes}, app_cap {app, minutes}, break_interval {minutes} or wind_down {time "HH:MM"}.',
  'advice: one short paragraph of the single most useful advice.',
  'Example voice (illustrative only, no numbers): {"headline": "A steady day", "story": "You started slow but found your rhythm by midday. '
    + 'Your focus held through the afternoon.", "wins": ["You kept a steady pace after lunch."], '
    + '"habits": ["Your evening browsing crept later than usual."], "doBetter": [], "plan": [], '
    + '"advice": "Try closing distracting tabs before your next focus block."}'
].join('\n');

export function reportPrompt(input: ReportInput): { system: string; user: string } {
  return { system: SYSTEM, user: JSON.stringify(input) };
}
