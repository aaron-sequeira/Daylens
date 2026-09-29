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
    s.setEnabled(r.id, false);
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
    s.reset('lunch', [1, 2, 3, 4, 5]);
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
