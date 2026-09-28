import { describe, it, expect } from 'vitest';
import { freeGb, navDates, needGb, writerState } from './view';

describe('report view helpers', () => {
  it('navigates between report days and today', () => {
    expect(navDates('2026-09-25', '2026-09-26', ['2026-09-26', '2026-09-25', '2026-09-20'])).toEqual({ prevDate: '2026-09-20', nextDate: '2026-09-26' });
    expect(navDates('2026-09-26', '2026-09-26', ['2026-09-25'])).toEqual({ prevDate: '2026-09-25', nextDate: null });
    expect(navDates('2026-09-20', '2026-09-26', ['2026-09-20'])).toEqual({ prevDate: null, nextDate: '2026-09-26' });
  });
  it('states the free memory a local write needs, in GB with one decimal (model file + 1 GiB)', () => {
    expect(needGb('4b')).toBe(3.6);   // 2 497 281 120 + 1 073 741 824 bytes
    expect(needGb('1.7b')).toBe(2.2); // 1 107 409 472 + 1 073 741 824 bytes
  });
  it('states free memory in GB with one decimal', () => {
    expect(freeGb(412_000_000)).toBe(0.4);
    expect(freeGb(2_160_000_000)).toBe(2.2);
  });
  it('derives the writer state, preferring an unavailable reason over "missing" in local mode', () => {
    const base = { mode: 'local' as const, hasKey: false, cloudModel: 'claude-haiku-4-5', tier: '4b' as const, unavailable: null };
    expect(writerState({ ...base, model: { state: 'missing' } })).toMatchObject({ state: 'missing', tier: '4b', sizeBytes: 2_497_281_120 });
    expect(writerState({ ...base, model: { state: 'missing' }, unavailable: 'low_ram' })).toMatchObject({ state: 'unavailable', reason: 'low_ram', text: expect.stringContaining('8 GB') });
    expect(writerState({ ...base, model: { state: 'ready' } })).toEqual({ state: 'ready', mode: 'local', model: 'Qwen3 4B' });
    expect(writerState({ ...base, model: { state: 'ready' }, unavailable: 'crashes' })).toMatchObject({ state: 'unavailable', reason: 'crashes' });
    expect(writerState({ ...base, model: { state: 'downloading', received: 5, total: 10, retrying: false } })).toEqual({ state: 'downloading', received: 5, total: 10 });
    expect(writerState({ ...base, model: { state: 'verifying' } })).toEqual({ state: 'verifying' });
    expect(writerState({ ...base, mode: 'cloud', model: { state: 'missing' }, unavailable: 'low_ram' })).toEqual({ state: 'cloud_setup' });
    expect(writerState({ ...base, mode: 'cloud', hasKey: true, model: { state: 'missing' } })).toEqual({ state: 'ready', mode: 'cloud', model: 'claude-haiku-4-5' });
  });
});
