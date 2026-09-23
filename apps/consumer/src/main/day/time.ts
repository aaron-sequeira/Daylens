import type { ActivitySampleRow, FocusSessionRow, ISODate } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';

export interface Interval { start: number; end: number; }
export const GAP_TOLERANCE_MS = 5_000; // buckets closer than this are contiguous

/** Periods without input: inactive buckets plus gaps between buckets (PC asleep / tracker off), merged. */
export function restPeriods(samples: ActivitySampleRow[]): Interval[] {
  const out: Interval[] = [];
  const push = (r: Interval): void => {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= GAP_TOLERANCE_MS) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  };
  let prevEnd: number | null = null;
  for (const s of [...samples].sort((a, b) => a.bucketStart - b.bucketStart)) {
    if (prevEnd !== null && s.bucketStart - prevEnd > GAP_TOLERANCE_MS) push({ start: prevEnd, end: s.bucketStart });
    if (s.active === 0) push({ start: s.bucketStart, end: s.bucketEnd });
    prevEnd = Math.max(prevEnd ?? s.bucketEnd, s.bucketEnd);
  }
  return out;
}

export const atLeast = (periods: Interval[], ms: number): Interval[] => periods.filter((p) => p.end - p.start >= ms);

/** Parts of `iv` not covered by any cut. ponytail: O(pieces × cuts), fine for one day of sessions. */
export function subtract(iv: Interval, cuts: Interval[]): Interval[] {
  let parts = [iv];
  for (const c of cuts) {
    parts = parts.flatMap((p) => (c.end <= p.start || c.start >= p.end ? [p] : [
      ...(c.start > p.start ? [{ start: p.start, end: c.start }] : []),
      ...(c.end < p.end ? [{ start: c.end, end: p.end }] : [])
    ]));
  }
  return parts;
}

export function clip(iv: Interval, lo: number, hi: number): Interval | null {
  const start = Math.max(iv.start, lo), end = Math.min(iv.end, hi);
  return end > start ? { start, end } : null;
}

export function dayBounds(date: ISODate): Interval {
  const [y, m, d] = date.split('-').map(Number);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

export function shiftDate(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days).getTime());
}

/** The latest session may still be open (runs to now); any other open session is a crash leftover and counts as 0. */
export function sessionInterval(s: FocusSessionRow, isLatest: boolean, now: number): Interval {
  const end = s.endedAt ?? (isLatest ? now : s.startedAt);
  return { start: s.startedAt, end: Math.max(s.startedAt, end) };
}
