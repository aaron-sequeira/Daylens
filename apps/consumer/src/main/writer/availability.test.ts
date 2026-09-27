import { describe, it, expect } from 'vitest';
import { countsAsFailure, localUnavailable, type AvailabilityInput } from './availability';
import { WRITER_MODELS } from './config';
import type { ModelStatus } from '../models/downloader';

const GiB = 1024 ** 3;
const base = (o: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  totalRam: 16 * GiB, freeDisk: 100 * GiB, model: WRITER_MODELS['4b'], installed: false, downloadedBytes: 0, downloadFailures: 0,
  declined: false, loadFailed: false, crashes: [], consecutiveTimeouts: 0, autoPaused: false, now: 1_000_000_000, ...o
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
  it('compares free disk with the bytes still to download, plus 1 GiB', () => {
    const size = WRITER_MODELS['4b'].size;
    expect(localUnavailable(base({ freeDisk: size + GiB - 1 }))).toBe('low_disk');
    expect(localUnavailable(base({ freeDisk: size + GiB }))).toBeNull();
    // Mid-download: the part already on disk no longer needs room.
    expect(localUnavailable(base({ freeDisk: 2 * GiB, downloadedBytes: size - GiB }))).toBeNull();
    expect(localUnavailable(base({ freeDisk: 2 * GiB - 1, downloadedBytes: size - GiB }))).toBe('low_disk');
  });
  it('stays "crashes" while automatic runs are paused, even once the 10-minute window has passed', () => {
    const now = 1_000_000_000;
    expect(localUnavailable(base({ autoPaused: true }))).toBe('crashes');
    expect(localUnavailable(base({ autoPaused: true, crashes: [now - 30 * 60_000, now - 29 * 60_000, now - 28 * 60_000] }))).toBe('crashes');
    expect(localUnavailable(base({ autoPaused: true, totalRam: 4 * GiB }))).toBe('low_ram'); // more fundamental reasons still come first
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
  it('does not count a cancelled download (a transition to missing)', () => {
    expect(countsAsFailure(downloading(false), missing, null)).toBe(false);
    expect(countsAsFailure(retry(100), missing, 100)).toBe(false);
  });
});
