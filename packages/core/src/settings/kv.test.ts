import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../db/schema';
import { createKvStore } from './kv';

const DEFAULTS = { goal: 420, paused: false, windDown: '23:00' };
let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCHEMA_SQL); });

describe('createKvStore', () => {
  it('returns defaults when nothing is stored', () => {
    expect(createKvStore(db, DEFAULTS).get()).toEqual(DEFAULTS);
  });
  it('round-trips numbers, booleans and strings with their types', () => {
    const kv = createKvStore(db, DEFAULTS);
    expect(kv.set({ goal: 300, paused: true, windDown: '22:30' })).toEqual({ goal: 300, paused: true, windDown: '22:30' });
    expect(createKvStore(db, DEFAULTS).get()).toEqual({ goal: 300, paused: true, windDown: '22:30' });
  });
  it('ignores keys that are not in the defaults', () => {
    const kv = createKvStore(db, DEFAULTS);
    kv.set({ nope: 1 } as never);
    expect(db.prepare("SELECT count(*) AS n FROM settings WHERE key = 'nope'").get()).toEqual({ n: 0 });
  });
  it('falls back to the default when a stored number is corrupt', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('goal', 'abc')").run();
    expect(createKvStore(db, DEFAULTS).get().goal).toBe(420);
  });
  it('works when set is called detached from the store object', () => {
    const { set } = createKvStore(db, DEFAULTS);
    expect(set({ goal: 100 }).goal).toBe(100);
  });
});
