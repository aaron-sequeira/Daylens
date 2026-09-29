export const ANIMATIONS = ['water', 'meal', 'tea', 'dinner', 'stretch', 'walk', 'eyes', 'medicine', 'call', 'breathe'] as const;
export type Animation = typeof ANIMATIONS[number];
export const ANIMATION_LOOK: Record<Animation, { emoji: string; label: string }> = {
  water: { emoji: '💧', label: 'Water' }, meal: { emoji: '🍱', label: 'Meal' }, tea: { emoji: '☕', label: 'Tea' },
  dinner: { emoji: '🍽️', label: 'Dinner' }, stretch: { emoji: '🧘', label: 'Stretch' }, walk: { emoji: '🚶', label: 'Walk' },
  eyes: { emoji: '👀', label: 'Eyes' }, medicine: { emoji: '💊', label: 'Medicine' }, call: { emoji: '📞', label: 'Call' },
  breathe: { emoji: '🌿', label: 'Breathe' }
};
export type Builtin = 'water' | 'lunch' | 'tea' | 'dinner' | 'travel_daylight' | 'travel_coffee';
export type Schedule = { type: 'time'; time: string; days: number[] } | { type: 'interval'; minutes: number };
export interface Reminder { id: number; builtin: Builtin | null; name: string; message: string; animation: Animation; schedule: Schedule; breakSec: number; enabled: boolean; }
export type ReminderInput = Pick<Reminder, 'name' | 'message' | 'animation' | 'schedule' | 'breakSec'> & { id?: number };
export interface ReminderState { lastFiredDate: string | null; lastFiredAt: number | null; lastDoneAt: number | null; }
export const LIMITS = { name: 40, message: 120, custom: 20, intervalMin: 15, intervalMax: 240, breakMin: 15, breakMax: 3600 } as const;
/** Break-length choices for the editor, seconds (0 = no break). */
export const BREAK_OPTIONS = [0, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function validateReminder(r: ReminderInput): string | null {
  const name = r.name.trim();
  if (!name) return 'Give it a name.';
  if (name.length > LIMITS.name) return 'Name is too long (40 characters max).';
  if (r.message.length > LIMITS.message) return 'Message is too long (120 characters max).';
  if (!(ANIMATIONS as readonly string[]).includes(r.animation)) return 'Choose an animation.';
  if (r.schedule.type === 'time') {
    if (!TIME.test(r.schedule.time)) return 'Pick a time.';
    if (!r.schedule.days.length || r.schedule.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return 'Pick at least one day.';
  } else if (!Number.isInteger(r.schedule.minutes) || r.schedule.minutes < LIMITS.intervalMin || r.schedule.minutes > LIMITS.intervalMax) {
    return 'Choose every 15 to 240 minutes.';
  }
  if (!Number.isInteger(r.breakSec) || (r.breakSec !== 0 && (r.breakSec < LIMITS.breakMin || r.breakSec > LIMITS.breakMax))) {
    return 'Break length must be 15 seconds to 60 minutes, or no break.';
  }
  return null;
}

export function builtinDefaults(workdays: number[]): Omit<Reminder, 'id'>[] {
  const days = workdays.length ? [...workdays].sort() : [1, 2, 3, 4, 5];
  return [
    { builtin: 'water', name: 'Water', message: 'A few big sips. Your focus will thank you.', animation: 'water', schedule: { type: 'interval', minutes: 60 }, breakSec: 30, enabled: true },
    { builtin: 'lunch', name: 'Lunch', message: 'Step away from the screen and enjoy it.', animation: 'meal', schedule: { type: 'time', time: '13:00', days }, breakSec: 1800, enabled: true },
    { builtin: 'tea', name: 'Tea break', message: 'Put the kettle on, stretch your legs, look out of a window.', animation: 'tea', schedule: { type: 'time', time: '16:00', days }, breakSec: 900, enabled: true },
    { builtin: 'dinner', name: 'Dinner', message: 'Time to eat. Screens can wait.', animation: 'dinner', schedule: { type: 'time', time: '19:30', days: ALL_DAYS }, breakSec: 1800, enabled: false }
  ];
}

const TITLES: Record<Builtin, string> = {
  water: 'Time for some water 💧', lunch: 'Lunch time 🍱', tea: 'Tea break ☕', dinner: 'Dinner time 🍽️',
  travel_daylight: 'Get some daylight ☀️', travel_coffee: 'Last coffee for today ☕'
};
export const reminderTitle = (r: Reminder): string => (r.builtin ? TITLES[r.builtin] : `${r.name.trim()} ${ANIMATION_LOOK[r.animation].emoji}`);

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
function daysText(days: number[]): string {
  const s = [...new Set(days)].sort();
  if (s.length === 7) return 'every day';
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '6,7') return 'weekends';
  return s.map((d) => DAY[d]).join(', ');
}
export function reminderSummary(r: Reminder): string {
  return r.schedule.type === 'interval'
    ? `Every ${r.schedule.minutes} min of screen time`
    : `${clock12(r.schedule.time)} · ${daysText(r.schedule.days)}`;
}
/** Local weekday of a timestamp, 1 = Monday … 7 = Sunday. */
export const localDayOf = (ms: number): number => ((new Date(ms).getDay() + 6) % 7) + 1;
