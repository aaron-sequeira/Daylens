import { describe, it, expect } from 'vitest';
import type { ActivitySampleRow } from '@worksight/core/types';
import { computeHealth } from './health';

const MIN = 60_000;
const T = (h: number, m = 0): number => new Date(2026, 8, 23, h, m).getTime();
const run = (from: number, minutes: number, active: 0 | 1): ActivitySampleRow[] =>
  Array.from({ length: minutes }, (_, i) => ({
    id: 0, bucketStart: from + i * MIN, bucketEnd: from + (i + 1) * MIN, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0, active, appName: 'Code', date: '2026-09-23'
  }));
const base = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };

describe('computeHealth', () => {
  it('is a perfect, NaN-free 100 on an empty day', () => {
    expect(computeHealth({ ...base, samples: [], screenSec: 0 })).toEqual({ score: 100, breaks: 0, expectedBreaks: 0, longestStretchSec: 0, lateNight: false });
  });
  it('penalises 3 h without a break: missed breaks and a long stretch', () => {
    const h = computeHealth({ ...base, samples: run(T(10), 180, 1), screenSec: 3 * 3600 });
    expect(h).toMatchObject({ breaks: 0, expectedBreaks: 3, longestStretchSec: 3 * 3600, lateNight: false });
    expect(h.score).toBe(65); // 100 - 15 (3 missed) - 20 (2 h over 1 h)
  });
  it('counts a 5-minute pause as a break and splits the stretch', () => {
    const samples = [...run(T(10), 60, 1), ...run(T(11), 5, 0), ...run(T(11, 5), 115, 1)];
    const h = computeHealth({ ...base, samples, screenSec: 3 * 3600 });
    expect(h).toMatchObject({ breaks: 1, expectedBreaks: 3, longestStretchSec: 115 * 60 });
    expect(h.score).toBe(81); // 100 - 10 - 9.17
  });
  it('does not count a 1-minute pause as a break', () => {
    const samples = [...run(T(10), 30, 1), ...run(T(10, 30), 1, 0), ...run(T(10, 31), 29, 1)];
    expect(computeHealth({ ...base, samples, screenSec: 3600 }).breaks).toBe(0);
  });
  it('flags late-night use after wind-down and before 5 am', () => {
    expect(computeHealth({ ...base, samples: run(T(23, 30), 10, 1), screenSec: 600 }).lateNight).toBe(true);
    expect(computeHealth({ ...base, samples: run(T(2), 10, 1), screenSec: 600 }).lateNight).toBe(true);
    expect(computeHealth({ ...base, samples: run(T(23, 30), 10, 0), screenSec: 0 }).lateNight).toBe(false);
    expect(computeHealth({ ...base, samples: run(T(21), 10, 1), screenSec: 600 }).lateNight).toBe(false);
  });
  it('treats a wind-down time after midnight as the start of late night, not the whole day', () => {
    const late = { ...base, windDownTime: '00:30' };
    expect(computeHealth({ ...late, samples: run(T(14), 10, 1), screenSec: 600 }).lateNight).toBe(false);
    expect(computeHealth({ ...late, samples: run(T(23, 30), 10, 1), screenSec: 600 }).lateNight).toBe(false);
    expect(computeHealth({ ...late, samples: run(T(1), 10, 1), screenSec: 600 }).lateNight).toBe(true);
    expect(computeHealth({ ...late, samples: run(T(0, 10), 10, 1), screenSec: 600 }).lateNight).toBe(false);
  });
  it('does not let an overnight sleep bucket wreck health (lid closed 22:59, opened 07:00)', () => {
    const overnight = { ...run(new Date(2026, 8, 22, 22, 59).getTime(), 1, 1)[0], bucketEnd: T(7) };
    const h = computeHealth({ ...base, samples: [overnight, ...run(T(7), 5, 1)], screenSec: 300 });
    expect(h).toEqual({ score: 100, breaks: 1, expectedBreaks: 0, longestStretchSec: 300, lateNight: false });
  });
  it('caps the over-goal penalty at 20 points', () => {
    const h = computeHealth({ ...base, dailyGoalMin: 60, samples: run(T(10), 30, 1), screenSec: 5 * 3600 });
    expect(h.score).toBe(80);
  });
  it('counts a completed break screen outside any detected rest as a break', () => {
    const samples = run(T(9), 120, 1); // 2 h of continuous activity, no 2-min rest
    const without = computeHealth({ ...base, samples, screenSec: 7200 });
    const withBreak = computeHealth({ ...base, samples, screenSec: 7200, breakScreens: [T(10)] });
    expect(withBreak.breaks).toBe(without.breaks + 1);
  });
});
