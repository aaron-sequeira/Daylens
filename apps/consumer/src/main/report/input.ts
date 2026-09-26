import type { Health } from '../day/health';
import type { TodayView } from '../day/today';
import { deepWorkSec, type Episode } from './episodes';
import type { ReportCandidate } from './candidates';

export const INPUT_EPISODES = 40;
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

export function buildReportInput(i: { stats: ReportStats; episodes: Episode[]; candidates: ReportCandidate[]; goals: ReportInput['goals'] }): ReportInput {
  const longest = [...i.episodes].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, INPUT_EPISODES).sort((a, b) => a.start - b.start);
  return {
    date: i.stats.date, stats: i.stats, candidates: i.candidates, goals: i.goals,
    episodes: longest.map((e) => ({ id: e.id, start: hhmm(e.start), end: hhmm(e.end), minutes: Math.round((e.end - e.start) / 60_000), app: e.app,
      category: e.category, activity: e.activity, titles: e.titles, samples: e.samples, stuck: r1(e.avgStuck), distraction: r1(e.avgDistraction) }))
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
