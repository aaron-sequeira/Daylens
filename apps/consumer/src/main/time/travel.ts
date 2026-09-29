import type { TzChange } from './zone';
import type { Reminder } from '../../shared/reminders';

const D = 24 * 3_600_000, WINDOW = 14 * D;
export const TRAVEL_WATER_MIN = 45;
const ALL = [1, 2, 3, 4, 5, 6, 7];

export interface TravelView { direction: 'east' | 'west'; fromHomeMin: number; back: boolean; day: number; days: number; endsAt: number; tips: string[]; }

/** The offset lived in longest over the last 14 days (wall-clock time — tracking rows don't store offsets). */
export function homeOffset(changes: TzChange[], currentOffset: number, now: number): number {
  const from = now - WINDOW;
  const inRange = changes.filter((c) => c.at > from && c.at <= now).sort((a, b) => a.at - b.at);
  const time = new Map<number, number>();
  const add = (o: number, ms: number): void => { time.set(o, (time.get(o) ?? 0) + ms); };
  let cursor = from, offset = inRange.length ? inRange[0].fromOffset : currentOffset;
  for (const c of inRange) { add(offset, c.at - cursor); cursor = c.at; offset = c.toOffset; }
  add(offset, now - cursor);
  return [...time.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const TIPS = {
  east: ['Get daylight between 8 and 10 am.', 'Last coffee by 2 pm.', 'Aim for an early night.'],
  west: ['Get daylight in the late afternoon.', 'Stay up until your usual local bedtime.', 'Last coffee by 3 pm.'],
  both: ['Naps: 20 minutes max, before 3 pm.', 'Drink extra water — flying dries you out.', 'Your wind-down reminder already follows local time.']
};

export function travelState(latest: TzChange | null, home: number, now: number, offUntil: number): TravelView | null {
  if (!latest) return null;
  const diff = latest.toOffset - latest.fromOffset;
  if (Math.abs(diff) < 180) return null;
  const days = Math.min(5, Math.max(2, Math.round(Math.abs(diff) / 180)));
  const endsAt = latest.at + days * D;
  if (now >= endsAt || offUntil >= endsAt || now < latest.at) return null;
  const direction = diff > 0 ? 'east' : 'west';
  const fromHomeMin = latest.toOffset - home;
  return { direction, fromHomeMin, back: fromHomeMin === 0, day: Math.floor((now - latest.at) / D) + 1, days, endsAt, tips: [...TIPS[direction], ...TIPS.both] };
}

export function travelReminders(v: TravelView): Reminder[] {
  const east = v.direction === 'east';
  return [
    { id: -1, builtin: 'travel_daylight', name: 'Daylight', message: 'Step outside or sit by a window for a while.', animation: 'walk',
      schedule: { type: 'time', time: east ? '09:00' : '16:00', days: ALL }, breakSec: 0, enabled: true },
    { id: -2, builtin: 'travel_coffee', name: 'Last coffee', message: 'Caffeine after this can keep you up tonight.', animation: 'tea',
      schedule: { type: 'time', time: east ? '14:00' : '15:00', days: ALL }, breakSec: 0, enabled: true }
  ];
}
