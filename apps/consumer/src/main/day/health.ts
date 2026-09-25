import type { ActivitySampleRow } from '@worksight/core/types';
import { atLeast, isActiveSample, restPeriods } from './time';

export const BREAK_MS = 2 * 60_000;
const EARLY_MORNING_MIN = 5 * 60; // activity before 05:00 also counts as late night
// Score weights (spec §9.5) — tune here.
const W = { missedBreak: 5, perHourOverOne: 10, lateNight: 15, overGoal: 20 };

export interface HealthInput { samples: ActivitySampleRow[]; screenSec: number; dailyGoalMin: number; windDownTime: string; breakIntervalMin: number; breakScreens?: number[]; }
export interface Health { score: number; breaks: number; expectedBreaks: number; longestStretchSec: number; lateNight: boolean; }

export function computeHealth(i: HealthInput): Health {
  const sorted = [...i.samples].sort((a, b) => a.bucketStart - b.bucketStart);
  const breaks = atLeast(restPeriods(sorted), BREAK_MS);
  // A completed break screen counts as a break unless it already sits inside a detected rest period.
  const screenBreaks = (i.breakScreens ?? []).filter((t) => !breaks.some((b) => t >= b.start && t <= b.end)).length;

  let longest = 0;
  if (sorted.length) {
    let edge = sorted[0].bucketStart;
    for (const b of breaks) { longest = Math.max(longest, b.start - edge); edge = Math.max(edge, b.end); }
    longest = Math.max(longest, sorted[sorted.length - 1].bucketEnd - edge);
  }

  const [wh, wm] = i.windDownTime.split(':').map(Number);
  const windDownMin = wh * 60 + wm;
  let activeMs = 0;
  let lateNight = false;
  for (const s of sorted) {
    if (!isActiveSample(s)) continue;
    activeMs += s.bucketEnd - s.bucketStart;
    const d = new Date(s.bucketStart);
    const minute = d.getHours() * 60 + d.getMinutes();
    // A wind-down after midnight (e.g. 00:30) means late night is [wind-down, 05:00), not "after 00:30 or before 05:00".
    const late = windDownMin < EARLY_MORNING_MIN
      ? minute >= windDownMin && minute < EARLY_MORNING_MIN
      : minute >= windDownMin || minute < EARLY_MORNING_MIN;
    if (late) lateNight = true;
  }

  const expectedBreaks = Math.floor(activeMs / 60_000 / i.breakIntervalMin);
  const totalBreaks = breaks.length + screenBreaks;
  const over = i.dailyGoalMin > 0 ? i.screenSec / (i.dailyGoalMin * 60) - 1 : 0;
  const raw = 100
    - W.missedBreak * Math.max(0, expectedBreaks - totalBreaks)
    - W.perHourOverOne * Math.max(0, longest / 3_600_000 - 1)
    - W.lateNight * (lateNight ? 1 : 0)
    - W.overGoal * Math.min(1, Math.max(0, over));
  return {
    score: Math.round(Math.min(100, Math.max(0, raw))),
    breaks: totalBreaks, expectedBreaks, longestStretchSec: Math.round(longest / 1000), lateNight
  };
}
