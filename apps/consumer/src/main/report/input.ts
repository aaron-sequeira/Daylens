import type { Health } from '../day/health';
import type { TodayView } from '../day/today';
import { deepWorkSec, type Episode } from './episodes';
import type { ReportCandidate } from './candidates';

export const INPUT_EPISODES = 40;
// Context budget for the local writer (6144 tokens, 1400 of them for the answer).
const SAMPLE_EPISODES = 8;
const SAMPLE_BUDGET = 4000;
const TITLE_CHARS = 80;
const INPUT_CHARS = 14_000; // ≈ what's left of the context for the input after the system prompt and schema
export interface ReportStats { date: string; screenSec: number; activeSec: number; goalSec: number; deepWorkSec: number; switches: number;
  health: Health; topApps: { appName: string; seconds: number }[]; categories: { category: string; seconds: number }[]; weekAvgSec: number; }
export interface WriterEpisode { id: string; start: string; end: string; minutes: number; app: string; category: string; activity: string | null;
  titles: string[]; samples: string[]; stuck: number; distraction: number; }
export interface ReportInput { date: string; stats: ReportStats; episodes: WriterEpisode[]; candidates: ReportCandidate[];
  goals: { dailyGoalMin: number; windDownTime: string; breakIntervalMin: number }; }

const hhmm = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const r1 = (x: number): number => Math.round(x * 10) / 10;

export function buildStats(view: TodayView, episodes: Episode[], switches: number): ReportStats {
  const prior = view.week.filter((d) => d.date !== view.date);
  return {
    date: view.date, screenSec: view.screenSec, activeSec: view.activeSec, goalSec: view.goalSec, deepWorkSec: deepWorkSec(episodes), switches,
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
 * first, so the shortest / least stuck lose theirs first. */
function budgetSamples(longest: Episode[], candidates: ReportCandidate[]): { samples: Map<string, string[]>; candidates: ReportCandidate[] } {
  let left = SAMPLE_BUDGET;
  const take = (s: string): boolean => (s.length <= left ? ((left -= s.length), true) : false);
  const cands = candidates.map(({ sample, ...c }) => (sample && take(sample) ? { ...c, sample } : c));
  const top = new Set(longest.slice(0, SAMPLE_EPISODES).map((e) => e.id));
  const samples = new Map<string, string[]>();
  for (const e of longest.filter((x) => isStuck(x) || top.has(x.id)).sort(priority)) samples.set(e.id, e.samples.filter(take));
  return { samples, candidates: cands };
}

/** Titles are the last thing to give way: while the input is over INPUT_CHARS, drop third titles, then second, then
 * first, from the shortest / least stuck episodes first. A normal day keeps all of them. */
function fitTitles(input: ReportInput, order: string[]): void {
  const byId = new Map(input.episodes.map((e) => [e.id, e]));
  for (let keep = 2; keep >= 0; keep--) {
    for (const id of [...order].reverse()) {
      if (JSON.stringify(input).length <= INPUT_CHARS) return;
      const e = byId.get(id);
      if (e && e.titles.length > keep) e.titles = e.titles.slice(0, keep);
    }
  }
}

export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'] }): ReportInput {
  const longest = [...i.episodes].sort((a, b) => dur(b) - dur(a)).slice(0, INPUT_EPISODES);
  const { samples, candidates } = budgetSamples(longest, i.candidates);
  const input: ReportInput = {
    date: i.stats.date, stats: i.stats, candidates, goals: i.goals,
    episodes: [...longest].sort((a, b) => a.start - b.start).map((e) => ({ id: e.id, start: hhmm(e.start), end: hhmm(e.end),
      minutes: Math.round(dur(e) / 60_000), app: e.app, category: e.category, activity: e.activity, titles: e.titles.map((t) => t.slice(0, TITLE_CHARS)),
      samples: samples.get(e.id) ?? [], stuck: r1(e.avgStuck), distraction: r1(e.avgDistraction) }))
  };
  fitTitles(input, [...longest].sort(priority).map((e) => e.id));
  return input;
}

/** The cloud gets only the compact input: no screen-text samples, from episodes or candidates (spec §3.3). */
export function forCloud(input: ReportInput): ReportInput {
  return {
    ...input,
    episodes: input.episodes.map((e) => ({ ...e, samples: [] })),
    candidates: input.candidates.map(({ sample: _sample, ...c }) => c)
  };
}

const SYSTEM = [
  "You are Daylens, a warm, concise coach writing a person's end-of-day report about their computer use.",
  'Write in second person ("you"), plain friendly English, no emoji, no markdown.',
  'Use only the facts in the input. Do not invent apps, events, problems or numbers; if you mention a number, copy it from the input.',
  'headline: one short line capturing the day. story: 3-5 sentences on how the day went, in time order.',
  'wins: up to 3 genuine positives. habits: up to 3 patterns worth watching, kind not judgmental.',
  'doBetter: up to 4 items; each MUST set candidateId to one of the ids in "candidates" and give what happened and a concrete better approach.',
  'plan: up to 4 suggestions for tomorrow, each with kind focus_block {start "HH:MM", minutes}, app_cap {app, minutes}, break_interval {minutes} or wind_down {time "HH:MM"}.',
  'advice: one short paragraph of the single most useful advice.'
].join('\n');

export function reportPrompt(input: ReportInput): { system: string; user: string } {
  return { system: SYSTEM, user: JSON.stringify(input) };
}
