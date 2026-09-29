import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { COACH_SCHEMA, createCoachStore, migrateCoachSchema, type CoachStore } from './store';

let s: CoachStore;
beforeEach(() => { const db = new Database(':memory:'); db.exec(COACH_SCHEMA); s = createCoachStore(db); });
const n = (at: number, status: 'shown' | 'held' = 'shown', key = `k${at}`) =>
  ({ at, date: '2026-09-25', kind: 'health' as const, ruleId: 'eye_break', key, title: 't', body: 'b', status });

describe('coach store', () => {
  it('schema is idempotent and records nudges with keys', () => {
    const id = s.record(n(1000));
    expect(s.since(0)).toEqual([{ id, ...n(1000) }]);
  });
  it('updates status and filters by time', () => {
    const a = s.record(n(1000)); s.record(n(5000));
    s.setStatus(a, 'dismissed');
    expect(s.since(0)[0].status).toBe('dismissed');
    expect(s.since(2000)).toHaveLength(1);
  });
  it('lists held nudges for a day', () => {
    s.record(n(1000, 'held')); s.record(n(2000, 'shown'));
    expect(s.heldForDay('2026-09-25').map((r) => r.at)).toEqual([1000]);
  });
  it('records breaks and returns completed ones', () => {
    s.recordBreak({ at: 1000, date: '2026-09-25', kind: 'eye', seconds: 20, completed: true });
    s.recordBreak({ at: 3000, date: '2026-09-25', kind: 'eye', seconds: 5, completed: false });
    expect(s.completedBreaksForDay('2026-09-25')).toEqual([1000]);
    expect(s.lastCompletedBreakAt()).toBe(1000);
  });
  it('clear() empties nudges and breaks', () => {
    s.record(n(1)); s.recordBreak({ at: 1, date: '2026-09-25', kind: 'eye', seconds: 20, completed: true });
    s.clear();
    expect(s.since(0)).toEqual([]);
    expect(s.lastCompletedBreakAt()).toBeNull();
  });
  it('migrates an old nudges table so reminder rows are allowed, keeping existing rows', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE nudges (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('health','behaviour','tip','win')), rule_id TEXT NOT NULL, key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('shown','held','dismissed','acted','snoozed','expired')));
      INSERT INTO nudges (at, date, kind, rule_id, key, title, body, status) VALUES (1, 'd', 'health', 'eye_break', 'k', 't', 'b', 'shown');`);
    db.exec(COACH_SCHEMA);
    migrateCoachSchema(db);
    migrateCoachSchema(db); // idempotent
    const s = createCoachStore(db);
    expect(s.since(0)).toHaveLength(1);
    expect(() => s.record({ at: 2, date: 'd', kind: 'reminder', ruleId: 'reminder', key: 'r', title: 't', body: 'b', status: 'shown' })).not.toThrow();
  });
  it('expireHeld() only changes a held row, and reports whether it changed', () => {
    const held = s.record(n(1000, 'held'));
    const shown = s.record(n(2000, 'shown'));
    expect(s.expireHeld(shown)).toBe(false);
    expect(s.since(0).find((r) => r.id === shown)?.status).toBe('shown');
    expect(s.expireHeld(held)).toBe(true);
    expect(s.since(0).find((r) => r.id === held)?.status).toBe('expired');
    expect(s.expireHeld(held)).toBe(false); // already expired: no longer 'held'
  });
});
