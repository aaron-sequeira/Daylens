import type { ActivitySampleRow } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';
import { atLeast, isActiveSample, isOversized, restPeriods } from '../day/time';
import { localDayOf, type Reminder, type ReminderState } from '../../shared/reminders';

export const CLOCK_WINDOW_MS = 60 * 60_000;
const PRESENT_BEFORE_MS = 5 * 60_000, PRESENT_AFTER_MS = 60_000, SETTLE_MS = 60_000, AWAY_RESET_MS = 10 * 60_000;
/** `effectiveMinutes`: for an interval reminder, the interval actually used (travel mode can shorten water's). */
export interface DueReminder { reminder: Reminder; slot: string; effectiveMinutes?: number; }
/** A locked-screen stretch; `end: null` = still locked. */
export interface AwayInterval { start: number; end: number | null; }

const LOCK_KEEP_MS = 24 * 3_600_000;
/** In-memory screen-lock stretches (lock-screen / unlock-screen events), the last 24 h. Not persisted: after an app
 * restart only sleep gaps count as away. */
export function createLockLog() {
  let list: AwayInterval[] = [];
  const open = (): AwayInterval | undefined => list.find((a) => a.end === null);
  return {
    lock(now: number): void { if (!open()) list.push({ start: now, end: null }); },
    unlock(now: number): void { const a = open(); if (a) a.end = now; },
    intervals(now: number): AwayInterval[] {
      list = list.filter((a) => a.end === null || a.end >= now - LOCK_KEEP_MS);
      return list.map((a) => ({ ...a }));
    }
  };
}

const localTime = (now: number, hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  return t.getTime();
};

/** Which reminder (at most one) should pop up now, plus clock reminders to mark as skipped because the user was
 * away at their time. Pure: the caller writes `skipped` to the store. `samples` = today's activity buckets;
 * `awayIntervals` = screen-lock stretches. "Away" means locked, or no bucket at all around the time (PC asleep /
 * tracker off) — not merely no input: an idle-but-unlocked user (a passive call, a video) is present. */
export function planReminders(i: {
  reminders: Reminder[]; states: Map<number, ReminderState>; now: number; samples: ActivitySampleRow[]; waterIntervalMin?: number;
  awayIntervals?: AwayInterval[];
}): { due: DueReminder | null; skipped: { id: number; date: string }[] } {
  const today = localDate(i.now), dow = localDayOf(i.now);
  const skipped: { id: number; date: string }[] = [];
  const clockDue: { r: Reminder; t: number }[] = [];
  const intervalDue: { r: Reminder; over: number; from: number; minutes: number }[] = [];
  const dayStart = new Date(i.now); dayStart.setHours(0, 0, 0, 0);
  const longRests = atLeast(restPeriods(i.samples), AWAY_RESET_MS);
  const lastRestEnd = longRests.length ? longRests[longRests.length - 1].end : 0;

  for (const r of i.reminders) {
    if (!r.enabled) continue;
    const s = i.states.get(r.id);
    if (r.schedule.type === 'time') {
      if (!r.schedule.days.includes(dow) || s?.lastFiredDate === today) continue;
      const t = localTime(i.now, r.schedule.time);
      if (i.now < t || i.now >= t + CLOCK_WINDOW_MS) continue;
      const locked = (i.awayIntervals ?? []).some((a) => a.start <= t && t <= (a.end ?? i.now));
      // Oversized buckets are flushes spanning sleep/suspend: they say nothing about the time they cover.
      const tracked = i.samples.some((x) => !isOversized(x) && x.bucketEnd >= t - PRESENT_BEFORE_MS && x.bucketStart <= t + PRESENT_AFTER_MS);
      const present = tracked && !locked;
      // The bucket covering the minute after `t` is only written about a minute later: decide "away" (a skip that lasts
      // the day) once that data can exist; before then an absent user just isn't due yet.
      if (!present) { if (i.now >= t + PRESENT_AFTER_MS + SETTLE_MS) skipped.push({ id: r.id, date: today }); continue; }
      clockDue.push({ r, t });
    } else {
      // The travel override only ever shortens water: a user's own shorter interval is kept.
      const minutes = r.builtin === 'water' && i.waterIntervalMin ? Math.min(i.waterIntervalMin, r.schedule.minutes) : r.schedule.minutes;
      const from = Math.max(dayStart.getTime(), s?.lastDoneAt ?? 0, s?.lastFiredAt ?? 0, lastRestEnd);
      const activeMs = i.samples.filter((x) => isActiveSample(x) && x.bucketStart >= from).reduce((a, x) => a + (x.bucketEnd - x.bucketStart), 0);
      if (activeMs >= minutes * 60_000) intervalDue.push({ r, over: activeMs / (minutes * 60_000), from, minutes });
    }
  }
  clockDue.sort((a, b) => a.t - b.t);
  intervalDue.sort((a, b) => b.over - a.over);
  const due = clockDue.length ? { reminder: clockDue[0].r, slot: today }
    : intervalDue.length ? { reminder: intervalDue[0].r, slot: String(intervalDue[0].from), effectiveMinutes: intervalDue[0].minutes } : null;
  return { due, skipped };
}
