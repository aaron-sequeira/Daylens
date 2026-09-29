import type Database from 'better-sqlite3';
import { localDate } from '@worksight/core/date';
import { LIMITS, builtinDefaults, validateReminder, type Builtin, type Reminder, type ReminderInput, type ReminderState, type Schedule } from '../../shared/reminders';

export const REMINDERS_SQL = `
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, builtin TEXT UNIQUE, name TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  animation TEXT NOT NULL, schedule_type TEXT NOT NULL CHECK (schedule_type IN ('time','interval')),
  time TEXT, days TEXT, interval_min INTEGER, break_sec INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_state (
  reminder_id INTEGER PRIMARY KEY, last_fired_date TEXT, last_fired_at INTEGER, last_done_at INTEGER
);
`;

type Row = { id: number; builtin: string | null; name: string; message: string; animation: string; schedule_type: string; time: string | null; days: string | null; interval_min: number | null; break_sec: number; enabled: number };
/** One damaged `days` value must not take down the whole list: it reads as "no days" (never fires) instead. */
const parseDays = (json: string | null): number[] => {
  try { const v: unknown = JSON.parse(json ?? '[]'); return Array.isArray(v) ? v.filter((d): d is number => Number.isInteger(d)) : []; } catch { return []; }
};
const toReminder = (r: Row): Reminder => ({
  id: r.id, builtin: r.builtin as Builtin | null, name: r.name, message: r.message, animation: r.animation as Reminder['animation'],
  schedule: r.schedule_type === 'time' ? { type: 'time', time: r.time ?? '12:00', days: parseDays(r.days) } : { type: 'interval', minutes: r.interval_min ?? 60 },
  breakSec: r.break_sec, enabled: r.enabled === 1
});
const cols = (s: Schedule) => (s.type === 'time'
  ? { schedule_type: 'time', time: s.time, days: JSON.stringify([...new Set(s.days)].sort()), interval_min: null }
  : { schedule_type: 'interval', time: null, days: null, interval_min: s.minutes });
const pastToday = (s: Schedule, now: number): boolean => {
  if (s.type !== 'time') return false;
  const [h, m] = s.time.split(':').map(Number);
  const t = new Date(now); t.setHours(h, m, 0, 0);
  return t.getTime() <= now;
};

export type ReminderStore = ReturnType<typeof createReminderStore>;

export function createReminderStore(db: Database.Database) {
  const all = db.prepare('SELECT * FROM reminders ORDER BY (builtin IS NULL), id');
  const one = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const ins = db.prepare(`INSERT INTO reminders (builtin, name, message, animation, schedule_type, time, days, interval_min, break_sec, enabled, created_at)
    VALUES (@builtin, @name, @message, @animation, @schedule_type, @time, @days, @interval_min, @break_sec, @enabled, @created_at)`);
  const seedIns = db.prepare(`INSERT OR IGNORE INTO reminders (builtin, name, message, animation, schedule_type, time, days, interval_min, break_sec, enabled, created_at)
    VALUES (@builtin, @name, @message, @animation, @schedule_type, @time, @days, @interval_min, @break_sec, @enabled, @created_at)`);
  const upd = db.prepare(`UPDATE reminders SET name=@name, message=@message, animation=@animation, schedule_type=@schedule_type, time=@time, days=@days,
    interval_min=@interval_min, break_sec=@break_sec WHERE id=@id`);
  const customCount = db.prepare('SELECT count(*) AS n FROM reminders WHERE builtin IS NULL');
  const state = db.prepare(`INSERT INTO reminder_state (reminder_id, last_fired_date, last_fired_at, last_done_at) VALUES (?, NULL, NULL, NULL)
    ON CONFLICT(reminder_id) DO NOTHING`);
  const setFiredDate = db.prepare('UPDATE reminder_state SET last_fired_date = ? WHERE reminder_id = ?');
  const setShown = db.prepare('UPDATE reminder_state SET last_fired_date = ?, last_fired_at = ? WHERE reminder_id = ?');
  const setDone = db.prepare('UPDATE reminder_state SET last_done_at = ? WHERE reminder_id = ?');
  const allState = db.prepare('SELECT reminder_id AS id, last_fired_date AS lastFiredDate, last_fired_at AS lastFiredAt, last_done_at AS lastDoneAt FROM reminder_state');
  const ensure = (id: number): void => { state.run(id); };
  // Only the columns each statement uses (better-sqlite3 rejects unknown named parameters).
  const fields = (r: Pick<Reminder, 'name' | 'message' | 'animation' | 'schedule' | 'breakSec'>) => ({ name: r.name.trim(), message: r.message.trim(), animation: r.animation, ...cols(r.schedule), break_sec: r.breakSec });
  const row = (r: Omit<Reminder, 'id'>, now: number) => ({ builtin: r.builtin, ...fields(r), enabled: r.enabled ? 1 : 0, created_at: now });
  const firedDate = db.prepare('SELECT last_fired_date AS d FROM reminder_state WHERE reminder_id = ?');
  /** A new schedule for today: a time already past starts next time (no instant pop-up); a time still ahead clears
   * today's fired/skipped mark, so a reminder moved later today still fires. Other days' marks are left alone. */
  const retimed = (id: number, s: Schedule, now: number): void => {
    if (s.type !== 'time') return;
    ensure(id);
    const today = localDate(now);
    if (pastToday(s, now)) setFiredDate.run(today, id);
    else if ((firedDate.get(id) as { d: string | null } | undefined)?.d === today) setFiredDate.run(null, id);
  };

  const store = {
    seed(workdays: number[]): void { for (const d of builtinDefaults(workdays)) seedIns.run(row(d, Date.now())); },
    list: (): Reminder[] => (all.all() as Row[]).map(toReminder),
    get: (id: number): Reminder | null => { const r = one.get(id) as Row | undefined; return r ? toReminder(r) : null; },
    /** Insert (no id) or update; throws a user-facing message when invalid. A time already past today starts next time. */
    save(input: ReminderInput, now: number): Reminder {
      const err = validateReminder(input);
      if (err) throw new Error(err);
      let id = input.id;
      let scheduleChanged = true;
      if (id === undefined) {
        if ((customCount.get() as { n: number }).n >= LIMITS.custom) throw new Error('You can have up to 20 reminders of your own.');
        id = Number(ins.run(row({ ...input, builtin: null, enabled: true }, now)).lastInsertRowid);
      } else {
        const cur = store.get(id);
        if (!cur) throw new Error('That reminder no longer exists.');
        scheduleChanged = JSON.stringify(cols(cur.schedule)) !== JSON.stringify(cols(input.schedule));
        upd.run({ ...fields({ ...cur, ...input }), id });
      }
      ensure(id);
      // Only a new or re-timed reminder skips a time already past today; renaming one mustn't swallow today's pop-up.
      if (scheduleChanged) retimed(id, input.schedule, now);
      return store.get(id) as Reminder;
    },
    remove(id: number): boolean {
      const r = store.get(id);
      if (!r || r.builtin) return false;
      db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
      db.prepare('DELETE FROM reminder_state WHERE reminder_id = ?').run(id);
      return true;
    },
    reset(builtin: Builtin, workdays: number[], now: number): void {
      const d = builtinDefaults(workdays).find((x) => x.builtin === builtin);
      const cur = store.list().find((r) => r.builtin === builtin);
      if (!d || !cur) return;
      upd.run({ ...fields(d), id: cur.id });
      db.prepare('UPDATE reminders SET enabled = ? WHERE id = ?').run(d.enabled ? 1 : 0, cur.id);
      if (!d.enabled) return;
      ensure(cur.id);
      if (!cur.enabled) { if (pastToday(d.schedule, now)) setFiredDate.run(localDate(now), cur.id); } // switched on by the reset
      else if (JSON.stringify(cols(cur.schedule)) !== JSON.stringify(cols(d.schedule))) retimed(cur.id, d.schedule, now);
    },
    /** The profile's workdays changed: built-in lunch/tea follow, unless the user already picked their own days. */
    syncWorkdays(prev: number[], next: number[]): void {
      if (!next.length) return;
      const same = (a: number[], b: number[]): boolean => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();
      for (const r of store.list()) {
        if ((r.builtin === 'lunch' || r.builtin === 'tea') && r.schedule.type === 'time' && same(r.schedule.days, prev) && !same(prev, next)) {
          db.prepare('UPDATE reminders SET days = ? WHERE id = ?').run(cols({ ...r.schedule, days: next }).days, r.id);
        }
      }
    },
    /** Switching a clock reminder on after its time today starts it next time (no instant pop-up). */
    setEnabled(id: number, on: boolean, now: number): void {
      const cur = store.get(id);
      if (!cur) return;
      db.prepare('UPDATE reminders SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id);
      if (on && !cur.enabled && pastToday(cur.schedule, now)) { ensure(id); setFiredDate.run(localDate(now), id); }
    },
    states(): Map<number, ReminderState> {
      return new Map((allState.all() as (ReminderState & { id: number })[]).map(({ id, ...s }) => [id, s]));
    },
    markFired(id: number, date: string): void { ensure(id); setFiredDate.run(date, id); },
    markShown(id: number, at: number, date: string): void { ensure(id); setShown.run(date, at, id); },
    markDone(id: number, at: number): void { ensure(id); setDone.run(at, id); },
    clearState(): void { db.exec('DELETE FROM reminder_state'); }
  };
  return store;
}
