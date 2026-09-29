import type { ReportInput } from './input';
import { allowedMinutes, reportPrompt } from './input';
import { groundNumbers, groundText, normalizeVoice, normalizeVoiceText, parseReport, REPORT_JSON_SCHEMA, type ReportJson } from './schema';
import type { ReportStore } from './store';
import { parseWeek, WEEK_JSON_SCHEMA, weekAllowedMinutes, weekForCloud, weekPrompt, type WeekInput, type WeekJson, type WeeklyStore } from './week';
import type { WriteJob, Writer } from '../writer/writer';

export type GenerateOutcome = 'ok' | 'failed' | 'crash' | 'timeout' | 'load';
const MAX_TOKENS = 1400;
const WEEK_MAX_TOKENS = 800; // headline 80 + summary 600 + focus 200 characters, with room for the JSON
const FALLBACK = "Couldn't write this report.";

/** Short user text for a raw writer failure. Raw text (file paths from `load: …`, provider bodies) never reaches the
 * UI. `kind` picks day vs. week wording for the one reason that names its subject ("too much to fit"). */
export function friendlyReason(raw: string, kind: 'day' | 'week' = 'day'): string {
  const r = raw.trim();
  if (r === 'timeout' || r.startsWith('no answer in') || /abort/i.test(r)) return 'The writer took too long.';
  if (r === 'crash' || /^exit(ed)?\b/.test(r)) return 'The writer stopped unexpectedly.';
  if (r === 'load' || r.startsWith('load:')) return "The writer model couldn't start.";
  if (r === 'no_model') return "The writer model isn't downloaded.";
  if (r === 'no_key') return 'Add your API key in Settings.';
  // deterministic: retrying won't help
  if (r === 'input too long') return kind === 'week' ? 'The week had too much to fit.' : 'The day had too much to fit.';
  if (/(?:HTTP |Error: )401\b/.test(r)) return 'The API key was rejected.';
  if (/(?:HTTP |Error: )429\b/.test(r)) return 'The AI provider is busy; try again later.';
  return FALLBACK;
}

/** The store calls shared by daily reports (keyed by date) and weekly summaries (keyed by week start). */
interface JobStore<T> {
  get(key: string): { status: string } | null;
  setPending(key: string, now: number): void;
  setReady(key: string, r: T, model: string, now: number): void;
  setFailed(key: string, error: string, now: number): void;
  noteError(key: string, error: string): void;
}

/** `epoch` changes when "Delete my activity" runs: a write that straddles it stores nothing. A failed regenerate of a
 * ready row keeps the old one and only notes why. `prepare` gathers the input and builds the writer job; if it throws,
 * the row fails with the generic text (the error is logged by `what`, never shown). */
async function runJob<T>(key: string, what: 'day' | 'week', deps: { writer: Writer; store: JobStore<T>; now(): number; epoch(): number },
  prepare: () => WriteJob<T>): Promise<GenerateOutcome> {
  const epoch = deps.epoch();
  const hadReport = deps.store.get(key)?.status === 'ready';
  const fail = (reason: string): void => {
    if (hadReport) deps.store.noteError(key, reason);
    else deps.store.setFailed(key, reason, deps.now());
  };
  let job: WriteJob<T>;
  try { job = prepare(); } catch (e) {
    console.error(`[report] could not gather the ${what}:`, key, String(e).slice(0, 100));
    fail(FALLBACK);
    return 'failed';
  }
  if (!hadReport) deps.store.setPending(key, deps.now());
  let r;
  try {
    r = await deps.writer.write<T>(job);
  } catch {
    if (deps.epoch() === epoch) fail('The writer stopped unexpectedly.');
    return 'failed';
  }
  if (deps.epoch() !== epoch) return 'failed';
  if (r.ok) { deps.store.setReady(key, r.value, r.model, deps.now()); return 'ok'; }
  const kind = r.local === 'timeout' || r.local === 'crash' || r.local === 'load' ? r.local : null;
  fail(friendlyReason(kind ?? r.reason, what));
  return kind ?? 'failed';
}

export async function generateReport(date: string, deps: { build(date: string): { input: ReportInput; candidateIds: Set<string> };
  writer: Writer; store: ReportStore; now(): number; epoch(): number }): Promise<GenerateOutcome> {
  return runJob<ReportJson>(date, 'day', deps, () => {
    const built = deps.build(date);
    const { system, user } = reportPrompt(built.input);
    const allowed = allowedMinutes(built.input);
    return { kind: 'report', system, user, schema: REPORT_JSON_SCHEMA, maxTokens: MAX_TOKENS,
      // Both local and cloud go through the same safety net: fix stray first-person voice, then drop any number
      // the writer invented (kept separate from parseReport's schema/shape checks).
      parse: (v) => { const p = parseReport(v, built.candidateIds); return p ? groundNumbers(normalizeVoice(p), allowed) : null; } };
  });
}

/** The weekly summary: same failure, keep-on-regenerate-failure and epoch rules as a daily report. The cloud gets the
 * week without locally written headlines; every field gets the voice fix and numeric grounding against the week's
 * real minutes. */
export async function generateWeek(ws: string, deps: { build(ws: string): { input: WeekInput }; writer: Writer; store: WeeklyStore;
  now(): number; epoch(): number; cloud(): boolean }): Promise<GenerateOutcome> {
  return runJob<WeekJson>(ws, 'week', deps, () => {
    const full = deps.build(ws).input;
    const input = deps.cloud() ? weekForCloud(full) : full;
    const { system, user } = weekPrompt(input);
    const allowed = weekAllowedMinutes(input);
    const fix = (s: string): string => groundText(normalizeVoiceText(s), allowed);
    return { kind: 'week', system, user, schema: WEEK_JSON_SCHEMA, maxTokens: WEEK_MAX_TOKENS,
      parse: (v) => {
        const p = parseWeek(v);
        return p ? { headline: fix(p.headline) || 'Your week', summary: fix(p.summary), focusForNextWeek: fix(p.focusForNextWeek) } : null;
      } };
  });
}
