import { describe, it, expect } from 'vitest';
import { renderOptions, buildSequence, tempBucket, toAnswer, layaState, sessionOptions, type LayaMeta, type TokenEncoder } from './laya';

const meta: LayaMeta = {
  max_len: 40, head_max_len: 24, temperature: [1, 1, 1], temperature_by_options: {},
  cls_id: 1, sep_id: 2, mask_id: 3, pad_id: 0, mask_token: '[MASK]'
};
// One token per character (code + 10) keeps positions easy to reason about.
const enc: TokenEncoder = { encode: (t) => [...t].map((c) => c.charCodeAt(0) + 10) };

describe('renderOptions', () => {
  it('renders choice criteria as "key: description" and bare keys for lists', () => {
    expect(renderOptions({ type: 'choice', instructions: 'x', criteria: { a: 'alpha', b: null } })).toEqual(['a: alpha', 'b']);
    expect(renderOptions({ type: 'choice', instructions: 'x', criteria: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  it('renders score criteria as levels', () => {
    expect(renderOptions({ type: 'score', instructions: 'x', criteria: ['low', 'high'] })).toEqual(['level 0: low', 'level 1: high']);
  });
});

describe('buildSequence', () => {
  it('lays out [CLS] head [SEP] [MASK]opt… [SEP] state [SEP] with markers on the masks', () => {
    const { ids, markers } = buildSequence(enc, meta, 'st', { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids[0]).toBe(meta.cls_id);
    expect(markers).toHaveLength(2);
    for (const m of markers) expect(ids[m]).toBe(meta.mask_id);
    expect(ids[ids.length - 1]).toBe(meta.sep_id);
    // state tokens sit right before the final [SEP]
    expect(ids.slice(-3, -1)).toEqual(enc.encode('st'));
  });
  it('truncates the state so the sequence never exceeds max_len', () => {
    const { ids } = buildSequence(enc, meta, 'x'.repeat(500), { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids.length).toBeLessThanOrEqual(meta.max_len);
    expect(ids[ids.length - 1]).toBe(meta.sep_id);
  });
  it('replaces the literal mask token inside user text', () => {
    const { ids } = buildSequence(enc, meta, '[MASK]', { type: 'choice', instructions: 'q', criteria: ['a', 'b'] });
    expect(ids.filter((t) => t === meta.mask_id)).toHaveLength(2);
  });
});

describe('tempBucket', () => {
  it('buckets by question type and option count', () => {
    expect(tempBucket(0, 2)).toBe('choice:2');
    expect(tempBucket(0, 6)).toBe('choice:6-10');
    expect(tempBucket(1, 3)).toBe('score:3-5');
    expect(tempBucket(0, 12)).toBe('choice:11+');
  });
});

describe('toAnswer', () => {
  it('picks the argmax choice with zero confidence on a uniform distribution', () => {
    const a = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 0], meta);
    expect(a.type).toBe('choice');
    if (a.type === 'choice') { expect(a.probabilities).toEqual({ a: 0.5, b: 0.5 }); expect(a.confidence).toBeCloseTo(0, 5); }
    const b = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 20], meta);
    if (b.type === 'choice') { expect(b.choice).toBe('b'); expect(b.confidence).toBeGreaterThan(0.99); }
  });
  it('computes the expected level for scores', () => {
    const a = toAnswer({ type: 'score', instructions: 'q', criteria: ['l', 'm', 'h'] }, [-30, -30, 30], meta);
    if (a.type === 'score') expect(a.score).toBeCloseTo(2, 3);
  });
  it('applies the per-bucket temperature', () => {
    const hot = { ...meta, temperature_by_options: { 'choice:2': 1000 } };
    const a = toAnswer({ type: 'choice', instructions: 'q', criteria: ['a', 'b'] }, [0, 20], hot);
    if (a.type === 'choice') expect(a.probabilities.b).toBeLessThan(0.51);
  });
});

describe('layaState', () => {
  it('formats app, title and text (first 1500 chars) exactly like the Python golden generator', () => {
    expect(layaState('Code', 't', 'hello')).toBe('App: Code\nWindow: t\nScreen text: hello');
    expect(layaState('Code', null, null)).toBe('App: Code\nWindow: \nScreen text: ');
    expect(layaState('C', 't', 'x'.repeat(2000)).endsWith('x'.repeat(1500))).toBe(true);
    expect(layaState('C', 't', 'x'.repeat(2000))).toHaveLength('App: C\nWindow: t\nScreen text: '.length + 1500);
  });
});

describe('sessionOptions', () => {
  it('uses half the logical CPUs (at least 1) for intra-op work and a single inter-op thread, with the memory arena and pattern off', () => {
    expect(sessionOptions(8)).toEqual({ intraOpNumThreads: 4, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false });
    expect(sessionOptions(7)).toEqual({ intraOpNumThreads: 3, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false });
    expect(sessionOptions(1)).toEqual({ intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false });
    expect(sessionOptions(0)).toEqual({ intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false });
  });
});
