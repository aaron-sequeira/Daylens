import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { restPeriods, MAX_SAMPLE_MS, atLeast, subtract, clip, dayBounds, shiftDate, sessionInterval, isLateNight, nextEarlyMorning } from './time';

const MIN = 60_000;
const T = (h: number, m = 0): number => new Date(2026, 8, 23, h, m).getTime();
const sample = (start: number, active: 0 | 1): ActivitySampleRow => ({
  id: 0, bucketStart: start, bucketEnd: start + MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: 'Code', date: '2026-09-23'
});
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => sample(from + i * MIN, active));

describe('restPeriods', () => {
  it('merges consecutive inactive buckets and splits on active ones', () => {
    const s = [...run(T(10), 5, 1), ...run(T(10, 5), 3, 0), ...run(T(10, 8), 2, 1), ...run(T(10, 10), 1, 0)];
    expect(restPeriods(s)).toEqual([{ start: T(10, 5), end: T(10, 8) }, { start: T(10, 10), end: T(10, 11) }]);
  });
  it('treats a gap between buckets (PC asleep, tracker off) as rest and merges it with adjacent inactivity', () => {
    const s = [...run(T(10), 2, 1), ...run(T(10, 2), 1, 0), ...run(T(11), 2, 1)];
    expect(restPeriods(s)).toEqual([{ start: T(10, 2), end: T(11) }]);
  });
  it('treats an oversized "active" bucket (one flush spanning sleep) as rest', () => {
    expect(MAX_SAMPLE_MS).toBe(3 * MIN);
    const lidClosed = new Date(2026, 8, 22, 22, 59).getTime();
    const overnight: ActivitySampleRow = { ...sample(lidClosed, 1), bucketEnd: T(7) };
    const s = [...run(lidClosed - 5 * MIN, 5, 1), overnight, ...run(T(7), 5, 1)];
    expect(restPeriods(s)).toEqual([{ start: lidClosed, end: T(7) }]);
    // a bucket of exactly 3 minutes is still a real (slightly late) bucket
    expect(restPeriods([{ ...sample(T(10), 1), bucketEnd: T(10, 3) }])).toEqual([]);
  });
  it('is order-independent and empty for no samples', () => {
    expect(restPeriods([])).toEqual([]);
    const s = [...run(T(10), 2, 0)].reverse();
    expect(restPeriods(s)).toEqual([{ start: T(10), end: T(10, 2) }]);
  });
});

describe('atLeast / subtract / clip', () => {
  it('filters by duration', () => {
    expect(atLeast([{ start: 0, end: MIN }, { start: 0, end: 3 * MIN }], 2 * MIN)).toEqual([{ start: 0, end: 3 * MIN }]);
  });
  it('removes cut intervals from an interval', () => {
    expect(subtract({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 90, end: 200 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
    expect(subtract({ start: 0, end: 100 }, [{ start: -5, end: 500 }])).toEqual([]);
    expect(subtract({ start: 0, end: 100 }, [])).toEqual([{ start: 0, end: 100 }]);
    expect(subtract({ start: 0, end: 100 }, [{ start: 10, end: 50 }, { start: 40, end: 80 }])).toEqual([{ start: 0, end: 10 }, { start: 80, end: 100 }]);
  });
  it('clips to bounds or returns null', () => {
    expect(clip({ start: 0, end: 100 }, 50, 200)).toEqual({ start: 50, end: 100 });
    expect(clip({ start: 0, end: 10 }, 50, 200)).toBeNull();
  });
});

describe('dates', () => {
  it('gives local midnight bounds and shifts dates', () => {
    expect(dayBounds('2026-09-23')).toEqual({ start: T(0), end: new Date(2026, 8, 24).getTime() });
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('sessionInterval', () => {
  const s = (endedAt: number | null): FocusSessionRow => ({ id: 1, appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: T(10), endedAt, durationSec: null, date: '2026-09-23' });
  it('uses endedAt when finished', () => { expect(sessionInterval(s(T(11)), false, T(12))).toEqual({ start: T(10), end: T(11) }); });
  it('runs the latest open session up to now', () => { expect(sessionInterval(s(null), true, T(12))).toEqual({ start: T(10), end: T(12) }); });
  it('counts an older open session (crash leftover) as zero length', () => { expect(sessionInterval(s(null), false, T(12))).toEqual({ start: T(10), end: T(10) }); });
});

describe('isLateNight', () => {
  it('checks wind-down window 23:00 (late = [23:00, 05:00))', () => {
    expect(isLateNight(T(23, 30), '23:00')).toBe(true); // after wind-down time
    expect(isLateNight(T(12), '23:00')).toBe(false); // before wind-down time
    expect(isLateNight(new Date(2026, 8, 24, 1).getTime(), '23:00')).toBe(true); // after midnight in wind-down window
  });
  it('checks wind-down window 01:00 (late = [01:00, 05:00))', () => {
    expect(isLateNight(new Date(2026, 8, 24, 1).getTime(), '01:00')).toBe(true); // at wind-down time after midnight
    expect(isLateNight(new Date(2026, 8, 24, 0, 30).getTime(), '01:00')).toBe(false); // before wind-down time
    expect(isLateNight(T(23), '01:00')).toBe(false); // before midnight wind-down
  });
  it('never fires for edge case 05:00 (wind-down = end time)', () => {
    expect(isLateNight(new Date(2026, 8, 23, 4).getTime(), '05:00')).toBe(false);
    expect(isLateNight(T(5), '05:00')).toBe(false);
    expect(isLateNight(T(12), '05:00')).toBe(false);
    expect(isLateNight(T(23), '05:00')).toBe(false);
  });
});

describe('nextEarlyMorning', () => {
  it('is today 05:00 before 05:00, else tomorrow 05:00 (local time)', () => {
    expect(nextEarlyMorning(new Date(2026, 8, 26, 2, 30).getTime())).toBe(new Date(2026, 8, 26, 5, 0).getTime());
    expect(nextEarlyMorning(new Date(2026, 8, 26, 5, 0).getTime())).toBe(new Date(2026, 8, 27, 5, 0).getTime());
    expect(nextEarlyMorning(new Date(2026, 8, 26, 22, 15).getTime())).toBe(new Date(2026, 8, 27, 5, 0).getTime());
    expect(nextEarlyMorning(new Date(2026, 8, 30, 23, 0).getTime())).toBe(new Date(2026, 9, 1, 5, 0).getTime()); // month rollover
  });
});
