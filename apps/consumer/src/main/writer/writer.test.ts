import { describe, it, expect } from 'vitest';
import { createWriter, parseJsonText, type WriteJob } from './writer';

const job: WriteJob<{ h: string }> = { kind: 'report', system: 's', user: 'u', schema: { type: 'object' }, maxTokens: 900,
  parse: (v) => (v && typeof (v as any).h === 'string' ? { h: (v as any).h } : null) };
const deps = (o: Partial<Parameters<typeof createWriter>[0]> = {}) => ({
  mode: () => 'local' as const, local: () => ({ modelPath: 'C:/m.gguf', model: 'Qwen3 4B' }),
  runLocal: async () => ({ ok: true as const, json: { h: 'hi' } }),
  cloud: async () => ({ ok: true as const, text: '{"h":"cloud"}' }), cloudModel: () => 'claude-haiku-4-5', ...o
});

describe('writer', () => {
  it('writes locally with the model path, schema and 180 s report timeout', async () => {
    let seen: any; let t = 0;
    const w = createWriter(deps({ runLocal: async (r, ms) => { seen = r; t = ms; return { ok: true, json: { h: 'hi' } }; } }));
    expect(await w.write(job)).toEqual({ ok: true, value: { h: 'hi' }, model: 'Qwen3 4B' });
    expect(seen).toMatchObject({ op: 'write', modelPath: 'C:/m.gguf', schema: { type: 'object' }, system: 's', user: 'u', maxTokens: 900 });
    expect(t).toBe(180_000);
  });
  it('fails when the local model is missing, and passes local failure reasons through', async () => {
    expect(await createWriter(deps({ local: () => null })).write(job)).toMatchObject({ ok: false, reason: 'no_model' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: false, reason: 'timeout', message: 't' }) })).write(job)).toMatchObject({ ok: false, local: 'timeout' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: true, json: { nope: 1 } }) })).write(job)).toMatchObject({ ok: false, local: 'invalid' });
  });
  it('uses the cloud in cloud mode, retrying once on invalid JSON', async () => {
    let calls = 0;
    const w = createWriter(deps({ mode: () => 'cloud', cloud: async () => (++calls === 1 ? { ok: true, text: 'not json' } : { ok: true, text: '```json\n{"h":"ok"}\n```' }) }));
    expect(await w.write(job)).toEqual({ ok: true, value: { h: 'ok' }, model: 'claude-haiku-4-5' });
    expect(calls).toBe(2);
  });
  it('reports cloud errors without retrying them', async () => {
    let calls = 0;
    const w = createWriter(deps({ mode: () => 'cloud', cloud: async () => { calls++; return { ok: false, error: 'failed', message: 'HTTP 401' }; } }));
    expect(await w.write(job)).toMatchObject({ ok: false, reason: 'HTTP 401' });
    expect(calls).toBe(1);
  });
  it('parses fenced and bare JSON', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('nope')).toBeNull();
  });
});
