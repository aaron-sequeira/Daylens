import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { REMINDERS_SQL, createReminderStore } from './store';
import type { ReminderInput } from '../../shared/reminders';

let db: Database.Database;
const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m).getTime(); // Wed 30 Sep 2026, local
const vit: ReminderInput = { name: 'Vitamins', message: '', animation: 'medicine', schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, breakSec: 0 };

describe('reminder store', () => {
  beforeEach(() => { db = new Database(':memory:'); db.exec(REMINDERS_SQL); });

  it('seeds the built-ins once (idempotent), using the given workdays', () => {
    const s = createReminderStore(db);
    s.seed([1, 2, 3]); s.seed([1, 2, 3, 4, 5]);
    const list = s.list();
    expect(list.map((r) => r.builtin)).toEqual(['water', 'lunch', 'tea', 'dinner']);
    expect(list[1].schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3] });
  });

  it('creates, updates, enables and deletes a custom reminder; built-ins cannot be deleted', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const r = s.save(vit, at(8));
    expect(s.list().at(-1)).toMatchObject({ id: r.id, builtin: null, name: 'Vitamins', enabled: true });
    s.save({ ...vit, id: r.id, name: 'Vitamin D' }, at(8));
    expect(s.get(r.id)?.name).toBe('Vitamin D');
    s.setEnabled(r.id, false, at(8));
    expect(s.get(r.id)?.enabled).toBe(false);
    expect(s.remove(r.id)).toBe(true);
    expect(s.remove(s.list()[0].id)).toBe(false);
  });

  it('rejects invalid input and more than 20 custom reminders', () => {
    const s = createReminderStore(db);
    expect(() => s.save({ ...vit, name: '' }, at(8))).toThrow('Give it a name.');
    for (let i = 0; i < 20; i++) s.save({ ...vit, name: `r${i}` }, at(8));
    expect(() => s.save(vit, at(8))).toThrow('You can have up to 20 reminders of your own.');
  });

  it('saving a time that already passed today starts it next time (no instant pop-up)', () => {
    const s = createReminderStore(db);
    const r = s.save(vit, at(10)); // 09:00 already passed at 10:00
    expect(s.states().get(r.id)?.lastFiredDate).toBe('2026-09-30');
    const r2 = s.save({ ...vit, name: 'later', schedule: { type: 'time', time: '11:00', days: [3] } }, at(10));
    expect(s.states().get(r2.id)?.lastFiredDate ?? null).toBeNull();
  });

  it('editing only the name of a reminder whose time has passed keeps today’s pending pop-up', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const lunch = s.list()[1];
    s.save({ ...lunch, name: 'Lunch break' }, at(13, 30)); // 13:00 passed, not shown yet, schedule unchanged
    expect(s.states().get(lunch.id)?.lastFiredDate ?? null).toBeNull();
    s.save({ ...lunch, schedule: { type: 'time', time: '12:00', days: [1, 2, 3, 4, 5] } }, at(13, 30)); // re-timed into the past
    expect(s.states().get(lunch.id)?.lastFiredDate).toBe('2026-09-30');
  });

  it('syncWorkdays moves built-in lunch/tea to the new workdays unless the user customised their days', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const [, lunch, tea, dinner] = s.list();
    s.save({ ...tea, schedule: { type: 'time', time: '16:00', days: [1, 3] } }, at(8)); // customised
    s.syncWorkdays([1, 2, 3, 4, 5], [7, 1, 2, 3, 4]);
    expect(s.get(lunch.id)?.schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4, 7] });
    expect(s.get(tea.id)?.schedule).toEqual({ type: 'time', time: '16:00', days: [1, 3] });
    expect(s.get(dinner.id)?.schedule).toEqual(dinner.schedule); // every day, not a workday reminder
    s.syncWorkdays([5, 4, 3, 2, 1], [1, 2, 3]); // prev no longer matches lunch's days: left alone
    expect(s.get(lunch.id)?.schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4, 7] });
    s.syncWorkdays([1, 2, 3, 4, 7], []); // no workdays: nothing to move to
    expect(s.get(lunch.id)?.schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4, 7] });
  });

  it('enabling or resetting a clock reminder whose time already passed today starts it next time', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const [, lunch, tea, dinner] = s.list();
    s.setEnabled(dinner.id, true, at(20)); // 19:30 passed
    expect(s.states().get(dinner.id)?.lastFiredDate).toBe('2026-09-30');
    s.setEnabled(tea.id, false, at(10)); s.setEnabled(tea.id, true, at(10)); // 16:00 still ahead
    expect(s.states().get(tea.id)?.lastFiredDate ?? null).toBeNull();
    s.setEnabled(lunch.id, true, at(13, 30)); // already on: turning it "on" again changes nothing
    expect(s.states().get(lunch.id)?.lastFiredDate ?? null).toBeNull();
    s.save({ ...lunch, schedule: { type: 'time', time: '12:15', days: [1, 2, 3, 4, 5] } }, at(8));
    s.reset('lunch', [1, 2, 3, 4, 5], at(13, 30)); // back to 13:00, which has passed
    expect(s.states().get(lunch.id)?.lastFiredDate).toBe('2026-09-30');
  });

  it('re-timing a reminder to later today clears today’s fired/skipped mark so it still fires', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const lunch = s.list()[1];
    s.markFired(lunch.id, '2026-09-30'); // skipped at 13:00
    s.save({ ...lunch, schedule: { type: 'time', time: '15:00', days: [1, 2, 3, 4, 5] } }, at(14));
    expect(s.states().get(lunch.id)?.lastFiredDate ?? null).toBeNull();
    s.markFired(lunch.id, '2026-09-29');
    s.save({ ...lunch, schedule: { type: 'time', time: '16:00', days: [1, 2, 3, 4, 5] } }, at(14));
    expect(s.states().get(lunch.id)?.lastFiredDate).toBe('2026-09-29'); // an older date isn't touched
    s.markFired(lunch.id, '2026-09-30');
    s.save({ ...lunch, name: 'Lunch!', schedule: { type: 'time', time: '16:00', days: [1, 2, 3, 4, 5] } }, at(14)); // schedule unchanged
    expect(s.states().get(lunch.id)?.lastFiredDate).toBe('2026-09-30');
  });

  it('a damaged days value reads as no days instead of breaking the whole list', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    db.prepare("UPDATE reminders SET days = 'not json' WHERE builtin = 'lunch'").run();
    const list = s.list();
    expect(list).toHaveLength(4);
    expect(list[1].schedule).toEqual({ type: 'time', time: '13:00', days: [] });
  });

  it('reset restores a built-in to its defaults; state marks work; clearState wipes state only', () => {
    const s = createReminderStore(db); s.seed([1, 2, 3, 4, 5]);
    const lunch = s.list()[1];
    s.save({ ...lunch, schedule: { type: 'time', time: '12:15', days: [1] } }, at(8));
    s.reset('lunch', [1, 2, 3, 4, 5], at(8));
    expect(s.get(lunch.id)?.schedule).toEqual({ type: 'time', time: '13:00', days: [1, 2, 3, 4, 5] });
    s.markShown(lunch.id, at(13), '2026-09-30'); s.markDone(lunch.id, at(13, 30));
    expect(s.states().get(lunch.id)).toEqual({ lastFiredDate: '2026-09-30', lastFiredAt: at(13), lastDoneAt: at(13, 30) });
    s.markFired(-1, '2026-09-30'); // travel reminders (negative ids) keep state too
    expect(s.states().get(-1)?.lastFiredDate).toBe('2026-09-30');
    s.clearState();
    expect(s.states().size).toBe(0);
    expect(s.list()).toHaveLength(4);
  });
});
