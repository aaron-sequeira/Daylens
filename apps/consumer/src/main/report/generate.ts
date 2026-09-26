import type { ReportInput } from './input';
import { reportPrompt } from './input';
import { parseReport, REPORT_JSON_SCHEMA, type ReportJson } from './schema';
import type { ReportStore } from './store';
import type { Writer } from '../writer/writer';

export type GenerateOutcome = 'ok' | 'failed' | 'crash' | 'timeout' | 'load';
const MAX_TOKENS = 1400;

export async function generateReport(date: string, deps: { build(date: string): { input: ReportInput; candidateIds: Set<string> };
  writer: Writer; store: ReportStore; now(): number }): Promise<GenerateOutcome> {
  let built;
  try { built = deps.build(date); } catch (e) { deps.store.setFailed(date, `Could not gather the day: ${String(e)}`, deps.now()); return 'failed'; }
  deps.store.setPending(date, deps.now());
  const { system, user } = reportPrompt(built.input);
  const r = await deps.writer.write<ReportJson>({ kind: 'report', system, user, schema: REPORT_JSON_SCHEMA, maxTokens: MAX_TOKENS,
    parse: (v) => parseReport(v, built.candidateIds) });
  if (r.ok) { deps.store.setReady(date, r.value, r.model, deps.now()); return 'ok'; }
  deps.store.setFailed(date, r.reason, deps.now());
  return r.local === 'timeout' || r.local === 'crash' || r.local === 'load' ? r.local : 'failed';
}
