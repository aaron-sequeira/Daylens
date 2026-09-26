import { describe, it, expect } from 'vitest';
import { generateReport } from './generate';
import type { ReportStore } from './store';

function store() {
  const log: string[] = [];
  const s = { setPending: (d: string) => log.push(`pending ${d}`), setReady: (d: string, r: any, m: string) => log.push(`ready ${d} ${r.headline} ${m}`),
    setFailed: (d: string, e: string) => log.push(`failed ${d} ${e}`) } as unknown as ReportStore;
  return { s, log };
}
const build = () => ({ input: { date: '2026-09-26' } as never, candidateIds: new Set(['stuck:e1']) });

describe('generateReport', () => {
  it('marks pending, writes, and stores the grounded report', async () => {
    const { s, log } = store();
    const writer = { write: async (job: any) => ({ ok: true, value: job.parse({ headline: 'Good day', story: 's', advice: 'a',
      doBetter: [{ candidateId: 'made:up', what: 'x', better: 'y' }] }), model: 'Qwen3 4B' }) } as never;
    expect(await generateReport('2026-09-26', { build, writer, store: s, now: () => 1 })).toBe('ok');
    expect(log).toEqual(['pending 2026-09-26', 'ready 2026-09-26 Good day Qwen3 4B']);
  });
  it('stores the failure reason and maps local failure kinds', async () => {
    for (const [local, outcome] of [['timeout', 'timeout'], ['crash', 'crash'], ['load', 'load'], ['invalid', 'failed'], [undefined, 'failed']] as const) {
      const { s, log } = store();
      const writer = { write: async () => ({ ok: false, reason: 'why', local }) } as never;
      expect(await generateReport('2026-09-26', { build, writer, store: s, now: () => 1 })).toBe(outcome);
      expect(log[1]).toBe('failed 2026-09-26 why');
    }
  });
  it('fails cleanly when building the input throws', async () => {
    const { s, log } = store();
    const writer = { write: async () => { throw new Error('never'); } } as never;
    expect(await generateReport('2026-09-26', { build: () => { throw new Error('db'); }, writer, store: s, now: () => 1 })).toBe('failed');
    expect(log).toEqual(['failed 2026-09-26 Could not gather the day: Error: db']);
  });
  it('handles writer.write throwing unexpectedly', async () => {
    const { s, log } = store();
    const writer = { write: async () => { throw new Error('writer crash'); } } as never;
    expect(await generateReport('2026-09-26', { build, writer, store: s, now: () => 1 })).toBe('failed');
    expect(log).toEqual(['pending 2026-09-26', 'failed 2026-09-26 The writer stopped unexpectedly.']);
  });
});
