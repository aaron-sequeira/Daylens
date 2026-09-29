import { describe, it, expect } from 'vitest';
import { breakLabel, emptyForm, formFrom } from './reminderForm';
import { builtinDefaults } from '../../shared/reminders';

describe('reminder form helpers', () => {
  it('a new reminder starts as a daily 9:00 no-break reminder with the breathe animation', () => {
    expect(emptyForm()).toEqual({ name: '', message: '', animation: 'breathe', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 });
  });
  it('editing copies the reminder fields', () => {
    const lunch = { ...builtinDefaults([1, 2, 3, 4, 5])[1], id: 2 };
    expect(formFrom(lunch)).toEqual({ id: 2, name: 'Lunch', message: lunch.message, animation: 'meal', schedule: lunch.schedule, breakSec: 1800 });
  });
  it('labels break lengths', () => {
    expect([0, 15, 30, 60, 120, 1800, 3600].map(breakLabel)).toEqual(['No break — just remind me', '15 seconds', '30 seconds', '1 minute', '2 minutes', '30 minutes', '60 minutes']);
  });
});
