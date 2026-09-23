import type { InputCounts } from '../types';

export function isActiveBucket(counts: InputCounts, systemIdleSec: number, thresholdSec: number): boolean {
  const hadInput = counts.mouseMoves + counts.clicks + counts.scrolls + counts.keyEvents > 0;
  return hadInput || systemIdleSec < thresholdSec;
}
