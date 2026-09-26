import type { CompleteRequest, CompleteResult } from '@worksight/core/ai';
import type { WriterRequest } from './protocol';
import type { LocalResult } from './run';

export type WriteKind = 'report' | 'week' | 'tip';
export interface WriteJob<T> { kind: WriteKind; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; parse(v: unknown): T | null; }
export type WriteResult<T> = { ok: true; value: T; model: string } | { ok: false; reason: string; local?: 'timeout' | 'crash' | 'load' | 'error' | 'invalid' };
export interface Writer { write<T>(job: WriteJob<T>): Promise<WriteResult<T>>; }

export const LOCAL_TIMEOUT_MS: Record<WriteKind, number> = { report: 180_000, week: 180_000, tip: 20_000 };
export const CLOUD_TIMEOUT_MS: Record<WriteKind, number> = { report: 60_000, week: 60_000, tip: 20_000 };
const CONTEXT_SIZE = 8192;

export function parseJsonText(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { return null; }
}

export function createWriter(deps: {
  mode(): 'local' | 'cloud';
  local(): { modelPath: string; model: string } | null;
  runLocal(req: WriterRequest, timeoutMs: number): Promise<LocalResult>;
  cloud(req: CompleteRequest, timeoutMs: number): Promise<CompleteResult>;
  cloudModel(): string;
}): Writer {
  return {
    async write<T>(job: WriteJob<T>): Promise<WriteResult<T>> {
      if (deps.mode() === 'cloud') {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await deps.cloud({ system: job.system, user: job.user, maxTokens: job.maxTokens, json: true }, CLOUD_TIMEOUT_MS[job.kind]);
          if (!r.ok) return { ok: false, reason: r.message ?? r.error };
          const parsed = parseJsonText(r.text);
          const value = parsed === null ? null : job.parse(parsed);
          if (value !== null) return { ok: true, value, model: deps.cloudModel() };
        }
        return { ok: false, reason: 'The AI returned an answer Daylens could not read.' };
      }
      const m = deps.local();
      if (!m) return { ok: false, reason: 'no_model' };
      const r = await deps.runLocal({ op: 'write', modelPath: m.modelPath, gpu: 'auto', schema: job.schema, system: job.system,
        user: job.user, maxTokens: job.maxTokens, contextSize: CONTEXT_SIZE }, LOCAL_TIMEOUT_MS[job.kind]);
      if (!r.ok) return { ok: false, reason: r.message, local: r.reason };
      const value = job.parse(r.json);
      return value === null ? { ok: false, reason: 'The writer returned an answer Daylens could not read.', local: 'invalid' } : { ok: true, value, model: m.model };
    }
  };
}
