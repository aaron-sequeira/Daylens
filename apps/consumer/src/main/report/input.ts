import type { Health } from '../day/health';
import type { TodayView } from '../day/today';
import { deepWorkSec, type Episode } from './episodes';
import type { ReportCandidate } from './candidates';

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

/** A hard cap: while the input is over INPUT_CHARS, give way in this order: third titles, then second, then first
 * (shortest / least stuck episodes first); then episodes' samples (least stuck first); then candidates' samples; then
 * whole episodes, shortest first; as a last resort, candidates from the end. A normal day keeps everything. */
function fitInput(input: ReportInput, order: string[]): void {
  const over = (): boolean => JSON.stringify(input).length > INPUT_CHARS;
  const byId = new Map(input.episodes.map((e) => [e.id, e]));
  const leastFirst = [...order].reverse().map((id) => byId.get(id)).filter((e): e is WriterEpisode => !!e);
  for (let keep = 2; keep >= 0; keep--) {
    for (const e of leastFirst) {
      if (!over()) return;
      if (e.titles.length > keep) e.titles = e.titles.slice(0, keep);
    }
  }
  for (const e of leastFirst) {
    if (!over()) return;
    e.samples = [];
  }
  for (let k = input.candidates.length - 1; k >= 0; k--) {
    if (!over()) return;
    const { sample: _sample, ...c } = input.candidates[k];
    input.candidates[k] = c;
  }
  for (const e of [...input.episodes].sort((a, b) => a.minutes - b.minutes)) {
    if (!over()) return;
    input.episodes = input.episodes.filter((x) => x !== e);
  }
  while (over() && input.candidates.length) input.candidates.pop();
}

export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'] }): ReportInput {
  const longest = [...i.episodes].sort((a, b) => dur(b) - dur(a)).slice(0, INPUT_EPISODES);
  const { samples, candidates } = budgetSamples(longest, i.candidates);
  const input: ReportInput = {
    date: i.stats.date, stats: i.stats, candidates, goals: i.goals,
    episodes: [...longest].sort((a, b) => a.start - b.start).map((e) => ({ id: e.id, start: hhmm(e.start),
      minutes: Math.round(dur(e) / 60_000), app: e.app, category: e.category, activity: e.activity, titles: e.titles.map((t) => t.slice(0, TITLE_CHARS)),
      samples: samples.get(e.id) ?? [], stuck: r1(e.avgStuck), distraction: r1(e.avgDistraction) }))
  };
  fitInput(input, [...longest].sort(priority).map((e) => e.id));
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
