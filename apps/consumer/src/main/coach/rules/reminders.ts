import type { Rule } from '../snapshot';
import { ANIMATION_LOOK, clock12, reminderTitle } from '../../../shared/reminders';

export const reminderRule: Rule = (s) => {
  const due = s.reminderDue;
  if (!due) return null;
  const r = due.reminder;
  const stat = r.schedule.type === 'time' ? clock12(r.schedule.time) : `${r.schedule.minutes} min`;
  const body = r.message.trim() || 'Time for a short break.';
  return {
    ruleId: 'reminder', kind: 'reminder', key: `reminder:${r.id}:${due.slot}`, mini: `${ANIMATION_LOOK[r.animation].emoji} ${r.name.trim()}`, stat,
    reminderId: r.id, title: reminderTitle(r), body,
    ...(r.breakSec > 0
      ? { primary: { label: 'Start break', action: 'break_reminder' as const }, secondary: { label: r.builtin === 'water' ? 'I had some' : 'Done' } }
      : { primary: { label: 'Done', action: 'reminder_done' as const } })
  };
};
