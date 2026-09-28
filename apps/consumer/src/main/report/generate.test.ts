import { describe, it, expect, vi } from 'vitest';
import { friendlyReason, generateReport } from './generate';
import type { ReportStore } from './store';

function store(status: 'ready' | 'failed' | null = null) {
  const log: string[] = [];
  const s = { get: () => (status ? { status } : null), setPending: (d: string) => log.push(`pending ${d}`),
    setReady: (d: string, r: any, m: string) => log.push(`ready ${d} ${r.headline} ${m}`),
    setFailed: (d: string, e: string) => log.push(`failed ${d} ${e}`), noteError: (d: string, e: string) => log.push(`note ${d} ${e}`) } as unknown as ReportStore;
  return { s, log };
}
const emptyInput = { date: '2026-09-26', facts: { screenMin: 360, activeMin: 300, deepWorkMin: 0, longestStretchMin: 60, breaks: 3,
  expectedBreaks: 6, lateNight: false, goalMin: 420, weekAvgMin: 300, topApps: [], switches: 10 }, episodes: [], candidates: [],
  detail: { apps: [], sites: [], videos: [], games: [], learning: [] }, week: { days: [], avgScreenMin: 0 } } as never;
const build = () => ({ input: emptyInput, candidateIds: new Set(['stuck:e1']) });
const base = { build, now: () => 1, epoch: () => 0 };
const okWriter = { write: async (job: any) => ({ ok: true, value: job.parse({ headline: 'Good day', story: 's', advice: 'a',
  doBetter: [{ candidateId: 'made:up', what: 'x', better: 'y' }] }), model: 'Qwen3 4B' }) } as never;

describe('generateReport', () => {
  it('marks pending, writes, and stores the grounded report', async () => {
    const { s, log } = store();
    expect(await generateReport('2026-09-26', { ...base, writer: okWriter, store: s })).toBe('ok');
    expect(log).toEqual(['pending 2026-09-26', 'ready 2026-09-26 Good day Qwen3 4B']);
  });
  it('stores a friendly failure reason and maps local failure kinds', async () => {
    for (const [local, reason, outcome, text] of [
      ['timeout', 'no answer in 180000 ms', 'timeout', 'The writer took too long.'],
      ['crash', 'exit 3221225477', 'crash', 'The writer stopped unexpectedly.'],
      ['load', 'load: C:\\Users\\me\\model.gguf is corrupt', 'load', "The writer model couldn't start."],
      ['error', 'input too long', 'failed', 'The day had too much to fit.'],
      ['invalid', 'The writer returned an answer Daylens could not read.', 'failed', "Couldn't write this report."],
      [undefined, 'HTTP 401 {"error":"bad key"}', 'failed', 'The API key was rejected.']
    ] as const) {
      const { s, log } = store();
      const writer = { write: async () => ({ ok: false, reason, local }) } as never;
      expect(await generateReport('2026-09-26', { ...base, writer, store: s })).toBe(outcome);
      expect(log[1]).toBe(`failed 2026-09-26 ${text}`);
    }
  });
  it('fails cleanly when building the input throws, without leaking the error text', async () => {
    const { s, log } = store();
    const writer = { write: async () => { throw new Error('never'); } } as never;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await generateReport('2026-09-26', { ...base, build: () => { throw new Error('db'); }, writer, store: s })).toBe('failed');
    expect(log).toEqual(["failed 2026-09-26 Couldn't write this report."]);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
  it('handles writer.write throwing unexpectedly', async () => {
    const { s, log } = store();
    const writer = { write: async () => { throw new Error('writer crash'); } } as never;
    expect(await generateReport('2026-09-26', { ...base, writer, store: s })).toBe('failed');
    expect(log).toEqual(['pending 2026-09-26', 'failed 2026-09-26 The writer stopped unexpectedly.']);
  });
  it('stores nothing after the write when "Delete my activity" ran meanwhile', async () => {
    for (const writer of [okWriter, { write: async () => ({ ok: false, reason: 'exit 1', local: 'crash' }) } as never, { write: async () => { throw new Error('x'); } } as never]) {
      const { s, log } = store();
      let epoch = 0;
      const w = { write: async (job: any) => { epoch++; return (writer as any).write(job); } } as never;
      expect(await generateReport('2026-09-26', { ...base, epoch: () => epoch, writer: w, store: s })).toBe('failed');
      expect(log).toEqual(['pending 2026-09-26']);
    }
  });
  it('keeps a good report when regenerating it fails, noting why', async () => {
    const { s, log } = store('ready');
    const writer = { write: async () => ({ ok: false, reason: 'no answer in 180000 ms', local: 'timeout' }) } as never;
    expect(await generateReport('2026-09-26', { ...base, writer, store: s })).toBe('timeout');
    expect(log).toEqual(['note 2026-09-26 The writer took too long.']); // no pending, no failed: the old report stays
    const ok = store('ready');
    expect(await generateReport('2026-09-26', { ...base, writer: okWriter, store: ok.s })).toBe('ok');
    expect(ok.log).toEqual(['ready 2026-09-26 Good day Qwen3 4B']);
  });
  it('still replaces a failed report with pending while rewriting it', async () => {
    const { s, log } = store('failed');
    expect(await generateReport('2026-09-26', { ...base, writer: okWriter, store: s })).toBe('ok');
    expect(log[0]).toBe('pending 2026-09-26');
  });
  it('normalizes first-person voice and drops invented numbers before storing the report', async () => {
    const { s, log } = store();
    const writer = { write: async (job: any) => ({ ok: true, value: job.parse({
      headline: 'My best day', story: 'I had a 90-minute deep-work streak today.', wins: ['I stayed on task'], habits: [], doBetter: [], advice: 'Watch my screen time.'
    }), model: 'Qwen3 4B' }) } as never;
    expect(await generateReport('2026-09-26', { ...base, writer, store: s })).toBe('ok');
    expect(log).toEqual(['pending 2026-09-26', 'ready 2026-09-26 My best day Qwen3 4B']); // headline untouched by grounding (no digits)
  });
  it('drops a fabricated deep-work claim (deepWorkMin is 0) and rewrites "my" before storing', async () => {
    const { s } = store();
    let saved: any = null;
    const store2 = { ...s, setReady: (d: string, r: any) => { saved = r; } } as never;
    const writer = { write: async (job: any) => ({ ok: true, value: job.parse({
      headline: 'A day', story: 'You had a 90-minute deep-work streak today.', wins: ['I stayed on task'], habits: [], doBetter: [], advice: 'Watch my screen time.'
    }), model: 'Qwen3 4B' }) } as never;
    expect(await generateReport('2026-09-26', { ...base, writer, store: store2 })).toBe('ok');
    expect(saved.story).toBe(''); // the only sentence claimed a 90-minute deep-work streak with deepWorkMin: 0
    expect(saved.wins).toEqual(['You stayed on task']);
    expect(saved.advice).toBe('Watch your screen time.');
  });
});

describe('friendlyReason', () => {
  it('maps raw writer failures to short user text', () => {
    const cases: [string, string][] = [
      ['timeout', 'The writer took too long.'], ['no answer in 180000 ms', 'The writer took too long.'],
      ['AbortError: This operation was aborted', 'The writer took too long.'],
      ['crash', 'The writer stopped unexpectedly.'], ['exit 1', 'The writer stopped unexpectedly.'], ['exit null', 'The writer stopped unexpectedly.'],
      ['exited without an answer', 'The writer stopped unexpectedly.'],
      ['load', "The writer model couldn't start."], ['load: failed to load C:\\secret\\path.gguf', "The writer model couldn't start."],
      ['no_model', "The writer model isn't downloaded."], ['no_key', 'Add your API key in Settings.'],
      ['input too long', 'The day had too much to fit.'],
      ['HTTP 401 {"error":{"message":"invalid key"}}', 'The API key was rejected.'], ['AuthenticationError: 401 {"type":"error"}', 'The API key was rejected.'],
      ['HTTP 429 slow down', 'The AI provider is busy; try again later.'], ['RateLimitError: 429 {"type":"error"}', 'The AI provider is busy; try again later.'],
      ['HTTP 500 oops', "Couldn't write this report."], ['generation failed', "Couldn't write this report."], ['', "Couldn't write this report."]
    ];
    for (const [raw, text] of cases) expect(friendlyReason(raw), raw).toBe(text);
  });
});
