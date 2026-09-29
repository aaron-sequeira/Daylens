import type { CompleteRequest, CompleteResult } from '@worksight/core/ai';
import type { WriterRequest } from './protocol';
import type { LocalResult } from './run';

export type WriteKind = 'report' | 'week' | 'tip';
export interface WriteJob<T> { kind: WriteKind; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; parse(v: unknown): T | null; }
export type WriteResult<T> = { ok: true; value: T; model: string } | { ok: false; reason: string; local?: 'timeout' | 'crash' | 'load' | 'error' | 'invalid' };
export interface Writer { write<T>(job: WriteJob<T>): Promise<WriteResult<T>>; }

export const LOCAL_TIMEOUT_MS: Record<WriteKind, number> = { report: 180_000, week: 180_000, tip: 20_000 };
export const CLOUD_TIMEOUT_MS: Record<WriteKind, number> = { report: 60_000, week: 60_000, tip: 20_000 };
const CONTEXT_SIZE = 6144;

export function parseJsonText(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { return null; }
}

/** The job's system prompt plus the schema, spelled out: the cloud has no grammar, and node-llama-cpp's docs
 * recommend describing the schema to the local model as well as constraining it with the grammar. */
const systemWithSchema = (job: Pick<WriteJob<unknown>, 'system' | 'schema'>): string =>
  job.system + '\n\nReply with only one JSON object matching this JSON schema (no prose, no code fences):\n' + JSON.stringify(job.schema);

export function createWriter(deps: {
  mode(): 'local' | 'cloud';
  local(): { modelPath: string; model: string } | null;
  runLocal(req: WriterRequest, timeoutMs: number): Promise<LocalResult>;
  cloud(req: CompleteRequest, timeoutMs: number): Promise<CompleteResult>;
  cloudModel(): string;
}): Writer {
  let gpuOff = false; // the CPU worked after a GPU failure: stay on it for this session
  return {
    async write<T>(job: WriteJob<T>): Promise<WriteResult<T>> {
      const system = systemWithSchema(job);
      if (deps.mode() === 'cloud') {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await deps.cloud({ system, user: job.user, maxTokens: job.maxTokens, json: true }, CLOUD_TIMEOUT_MS[job.kind]);
          if (!r.ok) return { ok: false, reason: r.message ?? r.error };
          const parsed = parseJsonText(r.text);
          const value = parsed === null ? null : job.parse(parsed);
          if (value !== null) return { ok: true, value, model: deps.cloudModel() };
        }
        return { ok: false, reason: 'The AI returned an answer Daylens could not read.' };
      }
      const m = deps.local();
      if (!m) return { ok: false, reason: 'no_model' };
      const run = (gpu: 'auto' | 'off'): Promise<LocalResult> => deps.runLocal({ op: 'write', modelPath: m.modelPath, gpu, schema: job.schema, system,
        user: job.user, maxTokens: job.maxTokens, contextSize: CONTEXT_SIZE }, LOCAL_TIMEOUT_MS[job.kind]);
      let r = await run(gpuOff ? 'off' : 'auto');
      // A GPU that crashes or won't load the model: retry once on the CPU; only the CPU's failure is the outcome.
      // A tip never retries: it forks at most one process, so a tip write can't overlap a report/labelling job
      // for longer than the single attempt takes (see coach/tip.ts's tipRewriteAllowed / index.ts's tipWriting).
      if (!r.ok && !gpuOff && job.kind !== 'tip' && (r.reason === 'crash' || r.reason === 'load')) {
        r = await run('off');
        if (r.ok) gpuOff = true;
      }
      if (!r.ok) return { ok: false, reason: r.message, local: r.reason };
      const value = job.parse(r.json);
      return value === null ? { ok: false, reason: 'The writer returned an answer Daylens could not read.', local: 'invalid' } : { ok: true, value, model: m.model };
    }
  };
}
