import type { ActivitySampleRow, FocusSessionRow, ISODate } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';

export interface Interval { start: number; end: number; }
export const EARLY_MORNING_MIN = 5 * 60; // activity before 05:00 also counts as late night
export const GAP_TOLERANCE_MS = 5_000; // buckets closer than this are contiguous
/** A real bucket is ~60 s. One longer than 3 buckets is a flush that spanned sleep/suspend (or a
 * missed suspend event): it says nothing about the time it covers, so it counts as rest, never as active. */
export const MAX_SAMPLE_MS = 3 * 60_000;
export const isOversized = (s: ActivitySampleRow): boolean => s.bucketEnd - s.bucketStart > MAX_SAMPLE_MS;
/** Bucket that really had input: active and not an oversized sleep-spanning flush. */
export const isActiveSample = (s: ActivitySampleRow): boolean => s.active === 1 && !isOversized(s);

/** Periods without input: inactive or oversized buckets plus gaps between buckets (PC asleep / tracker off), merged. */
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
    if (!isActiveSample(s)) push({ start: s.bucketStart, end: s.bucketEnd });
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

let dayShift: ((ms: number) => number) | null = null;
/** After travel, a stored date's rows were written in the zone of that day, not the current one. The provider maps a
 * moment to how far the clock has moved since (Σ later zone changes, ms); null = no shifting (pure local bounds). */
export function setDayShift(fn: ((dayStartMs: number) => number) | null): void { dayShift = fn; }

export function dayBounds(date: ISODate): Interval {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime(), end = new Date(y, m - 1, d + 1).getTime();
  if (!dayShift) return { start, end };
  // Same shift at both edges (every change came after the day): the old zone's day, exactly. A change during the day
  // gives different shifts: span both zones' versions of it so neither side is clipped (rows are picked by date, so
  // a wider span never pulls in another day's rows).
  const a = dayShift(start), b = dayShift(end);
  return { start: start + Math.min(a, b), end: end + Math.max(a, b) };
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

/** Check if a timestamp falls in the late-night window defined by windDownTime.
 * e.g. windDownTime "23:00" → late = [23:00, 05:00); windDownTime "01:00" → late = [01:00, 05:00);
 * windDownTime "05:00" (edge case: wind-down time = end time) → never late.
 * Handles cross-midnight windows: a timestamp at 00:30 is late if wind-down is 23:00 or 01:00. */
export function isLateNight(ms: number, windDownTime: string): boolean {
  const [wh, wm] = windDownTime.split(':').map(Number);
  const windMin = wh * 60 + wm;
  if (windMin === EARLY_MORNING_MIN) return false; // 05:00 wind-down never triggers "late"
  const d = new Date(ms);
  const minute = d.getHours() * 60 + d.getMinutes();
  return windMin < EARLY_MORNING_MIN
    ? minute >= windMin && minute < EARLY_MORNING_MIN
    : minute >= windMin || minute < EARLY_MORNING_MIN;
}

/** The next 05:00 local time (today's if `ms` is before 05:00): when an "until tomorrow" snooze ends. */
export function nextEarlyMorning(ms: number): number {
  const d = new Date(ms);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, EARLY_MORNING_MIN).getTime();
  return ms < at ? at : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, EARLY_MORNING_MIN).getTime();
}
