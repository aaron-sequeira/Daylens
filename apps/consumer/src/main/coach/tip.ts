import type { Candidate } from './types';
import type { Snapshot } from './snapshot';
import { displayAppName } from '../../shared/categories';
import { isExcluded } from '../screen/exclusions';
import { finalCategory } from '../brain/finalCategory';
import { normalizeVoiceText } from '../report/schema';

/** The only rules whose template pop-up may be replaced by a personal, writer-written suggestion. */
export const REWRITE_RULES: ReadonlySet<string> = new Set(['stuck_tip', 'repeat_search']);

export interface TipInput {
  ruleId: string; app: string; title: string | null;
  episode: { minutes: number; category: string | null; activity: string | null; avgStuck: number };
  template: { title: string; body: string };
}

const READ_MS = 30_000; // ~30s of screen time per label (matches report/episodes.ts)
const EPISODE_WINDOW_MS = 30 * 60_000;
// Same private-window patterns as report/detail.ts: never offered to the writer as a real title, even when it
// doesn't match one of the user's own exclusion patterns.
const PRIVATE = /InPrivate|Incognito|Private Browsing|\(Private\)/i;

const mean = (xs: (number | null)[]): number => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

/** Builds the writer's tip input from the candidate's rule id/template and the latest read on the snapshot.
 * Never includes screen text: only the app name, window title (minus exclusions/private windows) and the
 * numbers already computed for the coach (stuck score, minutes in the app). */
export function tipInput(c: Candidate, snap: Snapshot, exclusions: string[]): TipInput {
  const reads = snap.readsToday;
  const latest = reads.reduce<Snapshot['readsToday'][number] | null>((a, r) => (!a || r.at > a.at ? r : a), null);
  const appRaw = latest?.appName ?? '';
  const rawTitle = latest?.windowTitle ?? null;
  const title = rawTitle !== null && !isExcluded(exclusions, appRaw, rawTitle) && !PRIVATE.test(rawTitle) ? rawTitle : null;
  const recent = reads.filter((r) => r.appName === appRaw && snap.now - r.at <= EPISODE_WINDOW_MS);
  const category = latest?.category ? finalCategory(latest.category, latest.conf ?? 0, appRaw) : null;
  return {
    ruleId: c.ruleId, app: displayAppName(appRaw), title,
    episode: { minutes: Math.round((recent.length * READ_MS) / 60_000), category, activity: null, avgStuck: mean(recent.map((r) => r.stuck)) },
    template: { title: c.title, body: c.body }
  };
}

export interface TipJson { title: string; body: string }

const str = (maxLength: number) => ({ type: 'string', maxLength }) as const;
export const TIP_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', properties: { title: str(60), body: str(180) }, required: ['title', 'body']
};

const cut = (n: number, v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Validates the writer's tip answer: cuts to the schema limits, voice-normalised, null if either field is empty. */
export function parseTip(raw: unknown): TipJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = normalizeVoiceText(cut(60, o.title));
  const body = normalizeVoiceText(cut(180, o.body));
  return title && body ? { title, body } : null;
}

const TIP_SYSTEM = [
  "You are Daylens, a warm, concise coach rewriting a short pop-up tip about the person's computer use right now.",
  'Write in second person ("you"), plain friendly English, no emoji, no markdown.',
  "Always write to the reader as 'you' / 'your'. Never use 'I', 'me', 'my' or 'we'.",
  'Give exactly one short, practical, kind suggestion, in the same spirit as the template tip but more personal '
    + 'and specific to the app/activity given. Never scold or lecture.',
  'Use only the facts given. Do not invent apps, numbers or durations; if you mention a number, copy it from the input.',
  'title: at most 60 characters. body: at most 180 characters, one or two sentences.'
].join('\n');

export function tipPrompt(t: TipInput): { system: string; user: string } {
  return { system: TIP_SYSTEM, user: JSON.stringify(t) };
}
