import type { ReportInput } from './input';
import { allowedMinutes, reportPrompt } from './input';
import { groundNumbers, normalizeVoice, parseReport, REPORT_JSON_SCHEMA, type ReportJson } from './schema';
import type { ReportStore } from './store';
import type { Writer } from '../writer/writer';

export type GenerateOutcome = 'ok' | 'failed' | 'crash' | 'timeout' | 'load';
const MAX_TOKENS = 1400;
const FALLBACK = "Couldn't write this report.";

/** Short user text for a raw writer failure. Raw text (file paths from `load: …`, provider bodies) never reaches the UI. */
export function friendlyReason(raw: string): string {
  const r = raw.trim();
  if (r === 'timeout' || r.startsWith('no answer in') || /abort/i.test(r)) return 'The writer took too long.';
  if (r === 'crash' || /^exit(ed)?\b/.test(r)) return 'The writer stopped unexpectedly.';
  if (r === 'load' || r.startsWith('load:')) return "The writer model couldn't start.";
  if (r === 'no_model') return "The writer model isn't downloaded.";
  if (r === 'no_key') return 'Add your API key in Settings.';
  if (r === 'input too long') return 'The day had too much to fit.'; // deterministic: retrying won't help
  if (/(?:HTTP |Error: )401\b/.test(r)) return 'The API key was rejected.';
  if (/(?:HTTP |Error: )429\b/.test(r)) return 'The AI provider is busy; try again later.';
  return FALLBACK;
}

/** `epoch` changes when "Delete my activity" runs: a write that straddles it stores nothing. A failed regenerate of a
 * ready report keeps the old report and only notes why. */
export async function generateReport(date: string, deps: { build(date: string): { input: ReportInput; candidateIds: Set<string> };
  writer: Writer; store: ReportStore; now(): number; epoch(): number }): Promise<GenerateOutcome> {
  const epoch = deps.epoch();
  const hadReport = deps.store.get(date)?.status === 'ready';
  const fail = (reason: string): void => {
    if (hadReport) deps.store.noteError(date, reason);
    else deps.store.setFailed(date, reason, deps.now());
  };
  let built;
  try { built = deps.build(date); } catch (e) {
    console.error('[report] could not gather the day:', date, String(e).slice(0, 100));
    fail(FALLBACK);
    return 'failed';
  }
  if (!hadReport) deps.store.setPending(date, deps.now());
  const { system, user } = reportPrompt(built.input);
  let r;
  try {
    const allowed = allowedMinutes(built.input);
    r = await deps.writer.write<ReportJson>({ kind: 'report', system, user, schema: REPORT_JSON_SCHEMA, maxTokens: MAX_TOKENS,
      // Both local and cloud go through the same safety net: fix stray first-person voice, then drop any number
      // the writer invented (kept separate from parseReport's schema/shape checks).
      parse: (v) => { const p = parseReport(v, built.candidateIds); return p ? groundNumbers(normalizeVoice(p), allowed) : null; } });
  } catch {
    if (deps.epoch() === epoch) fail('The writer stopped unexpectedly.');
    return 'failed';
  }
  if (deps.epoch() !== epoch) return 'failed';
  if (r.ok) { deps.store.setReady(date, r.value, r.model, deps.now()); return 'ok'; }
  const kind = r.local === 'timeout' || r.local === 'crash' || r.local === 'load' ? r.local : null;
  fail(friendlyReason(kind ?? r.reason));
  return kind ?? 'failed';
}
