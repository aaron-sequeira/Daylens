import type { ActivitySampleRow } from '@worksight/core/types';
import { localDate } from '@worksight/core/date';
import { atLeast, isActiveSample, restPeriods } from '../day/time';
import { localDayOf, type Reminder, type ReminderState } from '../../shared/reminders';

export const CLOCK_WINDOW_MS = 60 * 60_000;
const PRESENT_BEFORE_MS = 5 * 60_000, PRESENT_AFTER_MS = 60_000, AWAY_RESET_MS = 10 * 60_000;
export interface DueReminder { reminder: Reminder; slot: string; }

const localTime = (now: number, hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  return t.getTime();
};

/** Which reminder (at most one) should pop up now, plus clock reminders to mark as skipped because the user was
 * away at their time. Pure: the caller writes `skipped` to the store. `samples` = today's activity buckets. */
export function planReminders(i: {
  reminders: Reminder[]; states: Map<number, ReminderState>; now: number; samples: ActivitySampleRow[]; waterIntervalMin?: number;
}): { due: DueReminder | null; skipped: { id: number; date: string }[] } {
  const today = localDate(i.now), dow = localDayOf(i.now);
  const skipped: { id: number; date: string }[] = [];
  const clockDue: { r: Reminder; t: number }[] = [];
  const intervalDue: { r: Reminder; over: number; from: number }[] = [];
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
      const present = i.samples.some((x) => isActiveSample(x) && x.bucketEnd >= t - PRESENT_BEFORE_MS && x.bucketStart <= t + PRESENT_AFTER_MS);
      if (!present) { skipped.push({ id: r.id, date: today }); continue; }
      clockDue.push({ r, t });
    } else {
      const minutes = r.builtin === 'water' && i.waterIntervalMin ? i.waterIntervalMin : r.schedule.minutes;
      const from = Math.max(dayStart.getTime(), s?.lastDoneAt ?? 0, s?.lastFiredAt ?? 0, lastRestEnd);
      const activeMs = i.samples.filter((x) => isActiveSample(x) && x.bucketStart >= from).reduce((a, x) => a + (x.bucketEnd - x.bucketStart), 0);
      if (activeMs >= minutes * 60_000) intervalDue.push({ r, over: activeMs / (minutes * 60_000), from });
    }
  }
  clockDue.sort((a, b) => a.t - b.t);
  intervalDue.sort((a, b) => b.over - a.over);
  const due = clockDue.length ? { reminder: clockDue[0].r, slot: today }
    : intervalDue.length ? { reminder: intervalDue[0].r, slot: String(intervalDue[0].from) } : null;
  return { due, skipped };
}
