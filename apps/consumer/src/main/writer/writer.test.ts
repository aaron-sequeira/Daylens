import { describe, it, expect } from 'vitest';
import { createWriter, parseJsonText, type WriteJob } from './writer';
import { REPORT_JSON_SCHEMA } from '../report/schema';

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
    expect(seen).toMatchObject({ op: 'write', modelPath: 'C:/m.gguf', schema: { type: 'object' }, user: 'u', maxTokens: 900 });
    expect(seen.system.startsWith('s\n\n')).toBe(true);
    expect(t).toBe(180_000);
  });
  it('tells both writers to reply with one JSON object matching the schema', async () => {
    const rjob = { ...job, schema: REPORT_JSON_SCHEMA };
    let cloudSystem = '', localSystem = '';
    await createWriter(deps({ mode: () => 'cloud', cloud: async (r) => { cloudSystem = r.system; return { ok: true, text: '{"h":"x"}' }; } })).write(rjob);
    await createWriter(deps({ runLocal: async (r) => { localSystem = r.system; return { ok: true, json: { h: 'x' } }; } })).write(rjob);
    for (const s of [cloudSystem, localSystem]) {
      expect(s).toMatch(/JSON/);
      for (const k of ['headline', 'doBetter', 'candidateId']) expect(s).toContain(`"${k}"`);
    }
    expect(localSystem).toBe(cloudSystem);
  });
  it('fails when the local model is missing, and passes local failure reasons through', async () => {
    expect(await createWriter(deps({ local: () => null })).write(job)).toMatchObject({ ok: false, reason: 'no_model' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: false, reason: 'timeout', message: 't' }) })).write(job)).toMatchObject({ ok: false, local: 'timeout' });
    expect(await createWriter(deps({ runLocal: async () => ({ ok: true, json: { nope: 1 } }) })).write(job)).toMatchObject({ ok: false, local: 'invalid' });
  });
  it('retries once on the CPU after a GPU crash, then stays on the CPU for the session', async () => {
    const gpus: string[] = [];
    const w = createWriter(deps({ runLocal: async (r) => { gpus.push(r.gpu); return r.gpu === 'auto' ? { ok: false, reason: 'crash', message: 'exit 1' } : { ok: true, json: { h: 'cpu' } }; } }));
    expect(await w.write(job)).toEqual({ ok: true, value: { h: 'cpu' }, model: 'Qwen3 4B' });
    expect(gpus).toEqual(['auto', 'off']);
    expect(await w.write(job)).toMatchObject({ ok: true });
    expect(gpus).toEqual(['auto', 'off', 'off']);
  });
  it('returns the CPU run\'s failure when the fallback fails too, and keeps trying the GPU next time', async () => {
    const gpus: string[] = [];
    const w = createWriter(deps({ runLocal: async (r) => { gpus.push(r.gpu); return { ok: false, reason: r.gpu === 'auto' ? 'load' : 'timeout', message: 'x' }; } }));
    expect(await w.write(job)).toMatchObject({ ok: false, local: 'timeout' });
    expect(gpus).toEqual(['auto', 'off']);
    await w.write(job);
    expect(gpus).toEqual(['auto', 'off', 'auto', 'off']); // the CPU never succeeded, so it isn't remembered
    const both = createWriter(deps({ runLocal: async () => ({ ok: false, reason: 'load', message: 'load: bad' }) }));
    expect(await both.write(job)).toMatchObject({ ok: false, local: 'load' });
  });
  it('does not fall back to the CPU after a timeout or an error', async () => {
    for (const reason of ['timeout', 'error'] as const) {
      const gpus: string[] = [];
      const w = createWriter(deps({ runLocal: async (r) => { gpus.push(r.gpu); return { ok: false, reason, message: 'x' }; } }));
      expect(await w.write(job)).toMatchObject({ ok: false, local: reason });
      expect(gpus).toEqual(['auto']);
    }
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
