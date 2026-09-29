import { describe, it, expect } from 'vitest';
import { builtinDefaults, reminderSummary, reminderTitle, validateReminder, type ReminderInput } from './reminders';

const base: ReminderInput = { name: 'Vitamins', message: '', animation: 'medicine', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5] }, breakSec: 0 };

describe('validateReminder', () => {
  it('accepts a valid reminder', () => { expect(validateReminder(base)).toBeNull(); });
  it('enforces the limits', () => {
    expect(validateReminder({ ...base, name: ' ' })).toBe('Give it a name.');
    expect(validateReminder({ ...base, name: 'x'.repeat(41) })).toBe('Name is too long (40 characters max).');
    expect(validateReminder({ ...base, message: 'x'.repeat(121) })).toBe('Message is too long (120 characters max).');
    expect(validateReminder({ ...base, schedule: { type: 'time', time: '25:00', days: [1] } })).toBe('Pick a time.');
    expect(validateReminder({ ...base, schedule: { type: 'time', time: '09:00', days: [] } })).toBe('Pick at least one day.');
    expect(validateReminder({ ...base, schedule: { type: 'interval', minutes: 10 } })).toBe('Choose every 15 to 240 minutes.');
    expect(validateReminder({ ...base, breakSec: 5 })).toBe('Break length must be 15 seconds to 60 minutes, or no break.');
    expect(validateReminder({ ...base, animation: 'rocket' as never })).toBe('Choose an animation.');
  });
});

describe('builtinDefaults', () => {
  it('seeds water/lunch/tea/dinner with the spec defaults and the profile workdays', () => {
    const d = builtinDefaults([1, 2, 3, 4]);
    expect(d.map((r) => [r.builtin, r.enabled, r.breakSec])).toEqual([['water', true, 30], ['lunch', true, 1800], ['tea', true, 900], ['dinner', false, 1800]]);
    expect(d[0].schedule).toEqual({ type: 'interval', minutes: 60 });
    expect(d[1].schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4] });
    expect(d[3].schedule).toEqual({ type: 'time', time: '19:30', days: [1, 2, 3, 4, 5, 6, 7] });
  });
});

describe('titles and summaries', () => {
  const [water, lunch] = builtinDefaults([1, 2, 3, 4, 5]).map((r, i) => ({ ...r, id: i + 1 }));
  it('built-ins have friendly titles; custom ones use name + emoji', () => {
    expect(reminderTitle(water)).toBe('Time for some water 💧');
    expect(reminderTitle(lunch)).toBe('Lunch time 🍱');
    expect(reminderTitle({ ...base, id: 9, builtin: null, enabled: true })).toBe('Vitamins 💊');
  });
  it('summaries read naturally', () => {
    expect(reminderSummary(water)).toBe('Every 60 min of screen time');
    expect(reminderSummary(lunch)).toBe('1:00 pm · Mon–Fri');
    expect(reminderSummary({ ...lunch, schedule: { type: 'time', time: '19:30', days: [1, 2, 3, 4, 5, 6, 7] } })).toBe('7:30 pm · every day');
    expect(reminderSummary({ ...lunch, schedule: { type: 'time', time: '08:05', days: [1, 3, 5] } })).toBe('8:05 am · Mon, Wed, Fri');
  });
});
