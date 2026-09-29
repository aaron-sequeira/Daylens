import { describe, it, expect } from 'vitest';
import { snap } from '../fixtures';
import { reminderRule } from './reminders';
import { builtinDefaults, type Reminder } from '../../../shared/reminders';

const [water, lunch] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 })) as Reminder[];

describe('reminderRule', () => {
  it('is silent with nothing due', () => { expect(reminderRule(snap({ reminderDue: null }))).toBeNull(); });
  it('turns a due break reminder into a Start-break pop-up with a Done-style secondary', () => {
    expect(reminderRule(snap({ reminderDue: { reminder: water, slot: '123' } }))).toEqual({
      ruleId: 'reminder', kind: 'reminder', key: 'reminder:1:123', mini: '💧 Water', stat: '60 min', reminderId: 1,
      title: 'Time for some water 💧', body: 'A few big sips. Your focus will thank you.',
      primary: { label: 'Start break', action: 'break_reminder' }, secondary: { label: 'I had some' }
    });
    expect(reminderRule(snap({ reminderDue: { reminder: lunch, slot: '2026-09-30' } }))).toMatchObject({ stat: '1:00 pm', secondary: { label: 'Done' } });
  });
  it('a no-break reminder has a single Done button', () => {
    const c = reminderRule(snap({ reminderDue: { reminder: { ...lunch, breakSec: 0 }, slot: 's' } }));
    expect(c).toMatchObject({ primary: { label: 'Done', action: 'reminder_done' } });
    expect(c?.secondary).toBeUndefined();
  });
});
