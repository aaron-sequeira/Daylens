import { describe, it, expect } from 'vitest';
import { countsAsFailure, localUnavailable, type AvailabilityInput } from './availability';
import { WRITER_MODELS } from './config';
import type { ModelStatus } from '../models/downloader';

const GiB = 1024 ** 3;
const base = (o: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  totalRam: 16 * GiB, freeDisk: 100 * GiB, model: WRITER_MODELS['4b'], installed: false, downloadFailures: 0,
  declined: false, loadFailed: false, crashes: [], consecutiveTimeouts: 0, now: 1_000_000_000, ...o
});
describe('local writer availability', () => {
  it('is available on a normal PC', () => { expect(localUnavailable(base())).toBeNull(); });
  it('flags each condition', () => {
    expect(localUnavailable(base({ totalRam: 7.9 * GiB }))).toBe('low_ram');
    expect(localUnavailable(base({ freeDisk: 3 * GiB }))).toBe('low_disk');
    expect(localUnavailable(base({ freeDisk: 3 * GiB, installed: true }))).toBeNull(); // already downloaded: disk no longer matters
    expect(localUnavailable(base({ downloadFailures: 2 }))).toBe('download_failed');
    expect(localUnavailable(base({ declined: true }))).toBe('declined');
    expect(localUnavailable(base({ loadFailed: true }))).toBe('load_failed');
    const now = 1_000_000_000;
    expect(localUnavailable(base({ crashes: [now - 1000, now - 2000, now - 3000] }))).toBe('crashes');
    expect(localUnavailable(base({ crashes: [now - 11 * 60_000, now - 2000, now - 3000] }))).toBeNull(); // oldest is outside 10 min
    expect(localUnavailable(base({ consecutiveTimeouts: 2 }))).toBe('timeouts');
    expect(localUnavailable(base({ freeDisk: null }))).toBeNull(); // unknown disk never blocks
  });
});

describe('countsAsFailure', () => {
  const missing: ModelStatus = { state: 'missing' };
  const downloading = (retrying: boolean, received = 0): ModelStatus => ({ state: 'downloading', received, total: 10, retrying });
  const retry = (received: number): ModelStatus => downloading(true, received);

  it('counts two consecutive retries with no progress between them (a fully blocked link)', () => {
    expect(countsAsFailure(downloading(false), retry(100), null)).toBe(true); // first retry: always counts
    expect(countsAsFailure(retry(100), retry(100), 100)).toBe(true); // second retry: same bytes on disk as the last one
  });
  it('does not count a retry that shows progress since the last one (a flaky but progressing link)', () => {
    expect(countsAsFailure(retry(100), retry(200), 100)).toBe(false);
  });
  it('counts reaching an error state', () => {
    expect(countsAsFailure(downloading(false), { state: 'error', reason: 'no_space' }, null)).toBe(true);
    expect(countsAsFailure(retry(100), { state: 'error', reason: 'bad_hash' }, 100)).toBe(true);
  });
  it('does not count plain progress (no retry involved)', () => {
    expect(countsAsFailure(downloading(false, 1), downloading(false, 5), null)).toBe(false);
    expect(countsAsFailure(missing, downloading(false), null)).toBe(false);
    expect(countsAsFailure(downloading(false), { state: 'ready' }, null)).toBe(false);
    expect(countsAsFailure(downloading(false), { state: 'verifying' }, null)).toBe(false);
  });
});
