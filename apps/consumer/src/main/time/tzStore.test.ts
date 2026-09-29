import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { TZ_SQL, createTzStore } from './tzStore';

describe('tz store', () => {
  it('records changes and returns them newest-last / latest', () => {
    const db = new Database(':memory:'); db.exec(TZ_SQL);
    const s = createTzStore(db);
    expect(s.latest()).toBeNull();
    s.record({ at: 10, fromName: 'A', toName: 'B', fromOffset: 0, toOffset: 540 });
    s.record({ at: 20, fromName: 'B', toName: 'A', fromOffset: 540, toOffset: 0 });
    expect(s.since(15)).toEqual([{ at: 20, fromName: 'B', toName: 'A', fromOffset: 540, toOffset: 0 }]);
    expect(s.latest()?.at).toBe(20);
    s.clear();
    expect(s.latest()).toBeNull();
  });
});
