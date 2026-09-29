import type { Candidate } from './types';
import type { Snapshot } from './snapshot';
import { displayAppName } from '../../shared/categories';
import { isExcluded } from '../screen/exclusions';
import { finalCategory } from '../brain/finalCategory';
import { normalizeVoiceText } from '../report/schema';
import { EMAIL } from '../report/detail';
import { writerUsable, type Unavailable } from '../writer/availability';

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

// Same normalisation stillIn (coach/activity.ts) uses to compare an app name from a session against one from a read.
const appKey = (a: string): string => displayAppName(a).toLowerCase();

/** Builds the writer's tip input from the candidate's rule id/template and the coach's own snapshot. Never
 * includes screen text: only the app name, window title (minus exclusions/private windows/email addresses)
 * and the numbers already computed for the coach (stuck score, minutes in the app). */
export function tipInput(c: Candidate, snap: Snapshot, exclusions: string[]): TipInput {
  const reads = snap.readsToday;

  // Prefer the read for the app the user is actually in right now (the latest focus session), so a read that
  // straggled in late for an app the user has since left doesn't hijack the tip; fall back to the latest read
  // overall only when nothing matches that app (e.g. no read has arrived for it yet).
  let lastSession: Snapshot['sessions'][number] | null = null;
  for (const s of snap.sessions) if (!lastSession || s.startedAt >= lastSession.startedAt) lastSession = s;
  const sessionKey = lastSession ? appKey(lastSession.appName) : null;
  const matching = sessionKey !== null ? reads.filter((r) => appKey(r.appName) === sessionKey) : [];
  const pool = matching.length ? matching : reads;
  const latest = pool.reduce<Snapshot['readsToday'][number] | null>((a, r) => (!a || r.at > a.at ? r : a), null);
  const appRaw = latest?.appName ?? '';

  const rawTitle = latest?.windowTitle ?? null;
  const title = rawTitle !== null && !isExcluded(exclusions, appRaw, rawTitle) && !PRIVATE.test(rawTitle) && !EMAIL.test(rawTitle) ? rawTitle : null;

  // Episode minutes: a consecutive run of appRaw's own reads ending at `latest`, within the last 30 min — a
  // read of a different app in between breaks the run, so a brief app-switch and back doesn't inflate it.
  const sorted = [...reads].sort((a, b) => a.at - b.at);
  const anchorIdx = latest ? sorted.indexOf(latest) : -1;
  const run: typeof reads = [];
  for (let i = anchorIdx; i >= 0; i--) {
    const r = sorted[i];
    if (appKey(r.appName) !== appKey(appRaw) || snap.now - r.at > EPISODE_WINDOW_MS) break;
    run.unshift(r);
  }

  const category = latest?.category ? finalCategory(latest.category, latest.conf ?? 0, appRaw) : null;
  return {
    ruleId: c.ruleId, app: displayAppName(appRaw), title,
    episode: { minutes: Math.round((run.length * READ_MS) / 60_000), category, activity: null, avgStuck: mean(run.map((r) => r.stuck)) },
    template: { title: c.title, body: c.body }
  };
}

export interface TipJson { title: string; body: string }

const str = (maxLength: number) => ({ type: 'string', maxLength }) as const;
export const TIP_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', properties: { title: str(60), body: str(180) }, required: ['title', 'body']
};

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validates the writer's tip answer: voice-normalised first (so a rewrite like "I" -> "You" never gets cut in
 * half), then cut to the schema limits; null if either field is empty. */
export function parseTip(raw: unknown): TipJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = normalizeVoiceText(asString(o.title)).slice(0, 60);
  const body = normalizeVoiceText(asString(o.body)).slice(0, 180);
  return title && body ? { title, body } : null;
}

// Plain digit runs, the same extraction report/input.ts uses to ground candidate-derived numbers.
const numbersIn = (text: string): number[] => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));

/** Real numbers the writer may safely repeat back when rewriting a tip: the episode minutes plus any number in the
 * template body (so "a 5-min walk" doesn't flag its own "5"). Not the title: it holds counts and the user's search text. */
export function tipAllowedMinutes(t: TipInput): number[] {
  return [t.episode.minutes, ...numbersIn(t.template.body)];
}

export interface TipRewriteGate {
  mode: 'local' | 'cloud'; installed: boolean; hasKey: boolean; unavailable: Unavailable | null;
  reportRunning: boolean; labelling: boolean; tipWriting: boolean; freeBytes: number; needBytes: number;
}

/** Whether a stuck_tip/repeat_search template may be sent to the writer right now: the writer itself must be
 * usable (writerUsable — the same check report/scheduler.ts's canWrite uses), no report/week job, labelling
 * batch or other tip write may already be in flight (two-way mutual exclusion with both schedulers), and
 * (local mode only) there must be enough free memory for the writer's model. */
export function tipRewriteAllowed(i: TipRewriteGate): boolean {
  if (!writerUsable(i)) return false;
  if (i.reportRunning || i.labelling || i.tipWriting) return false;
  if (i.mode === 'local' && i.freeBytes < i.needBytes) return false;
  return true;
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
