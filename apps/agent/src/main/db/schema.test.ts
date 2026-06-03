import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

describe('schema', () => {
  it('applies cleanly to an in-memory database', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['activity_samples', 'app_events', 'daily_summaries', 'focus_sessions', 'settings']));
    db.close();
  });
});
