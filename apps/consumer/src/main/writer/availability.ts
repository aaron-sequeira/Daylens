import type { ModelStatus } from '../models/downloader';
import type { WriterModel } from './config';

const GiB = 1024 ** 3;
const CRASH_WINDOW_MS = 10 * 60_000;
export type Unavailable = 'low_ram' | 'low_disk' | 'download_failed' | 'declined' | 'load_failed' | 'crashes' | 'timeouts';
export interface AvailabilityInput {
  totalRam: number; freeDisk: number | null; model: WriterModel; installed: boolean; downloadFailures: number;
  declined: boolean; loadFailed: boolean; crashes: number[]; consecutiveTimeouts: number; now: number;
}

/** Why this PC can't use the local writer right now (→ offer cloud), or null. Order = most fundamental first. */
export function localUnavailable(i: AvailabilityInput): Unavailable | null {
  if (i.totalRam < 8 * GiB) return 'low_ram';
  if (!i.installed && i.freeDisk !== null && i.freeDisk < i.model.size + GiB) return 'low_disk';
  if (i.declined) return 'declined';
  if (i.downloadFailures >= 2) return 'download_failed';
  if (i.loadFailed) return 'load_failed';
  if (i.crashes.filter((t) => i.now - t < CRASH_WINDOW_MS).length >= 3) return 'crashes';
  if (i.consecutiveTimeouts >= 2) return 'timeouts';
  return null;
}

/** One failed download attempt: entering `error`, or a fresh retry (not already retrying). Plain
 * progress (received bytes moving, or staying in the same retrying/non-retrying state) never counts. */
export function countsAsFailure(prev: ModelStatus, next: ModelStatus): boolean {
  if (next.state === 'error') return true;
  const wasRetrying = prev.state === 'downloading' && prev.retrying;
  const isRetrying = next.state === 'downloading' && next.retrying;
  return isRetrying && !wasRetrying;
}

export const UNAVAILABLE_TEXT: Record<Unavailable, string> = {
  low_ram: 'This PC has less than 8 GB of memory, too little to run the writer.',
  low_disk: 'Not enough free disk space for the writer model.',
  download_failed: "The writer model couldn't be downloaded.",
  declined: "You chose not to download the writer model.",
  load_failed: "The writer model couldn't start on this PC.",
  crashes: 'The writer kept crashing on this PC.',
  timeouts: 'The writer was too slow on this PC.'
};
