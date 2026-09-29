import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { TZ_SQL, createTzStore, mayRecordTz } from './tzStore';

describe('mayRecordTz', () => {
  it('records where you travelled only with consent and while tracking runs', () => {
    expect(mayRecordTz({ consentGranted: true, trackingPaused: false })).toBe(true);
    expect(mayRecordTz({ consentGranted: false, trackingPaused: false })).toBe(false);
    expect(mayRecordTz({ consentGranted: true, trackingPaused: true })).toBe(false);
  });
});

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
