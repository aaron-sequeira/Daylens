import type { Reminder, ReminderInput } from '../../shared/reminders';

export const emptyForm = (): ReminderInput => ({ name: '', message: '', animation: 'breathe', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 });
export const formFrom = (r: Reminder): ReminderInput => ({ id: r.id, name: r.name, message: r.message, animation: r.animation, schedule: r.schedule, breakSec: r.breakSec });
export function breakLabel(sec: number): string {
  if (sec === 0) return 'No break — just remind me';
  if (sec < 60) return `${sec} seconds`;
  const m = sec / 60;
  return m === 1 ? '1 minute' : `${m} minutes`;
}
