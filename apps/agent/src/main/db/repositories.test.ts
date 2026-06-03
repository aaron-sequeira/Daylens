import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';
import { createRepositories, Repositories } from './repositories';

let repo: Repositories;
beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  repo = createRepositories(db);
});

describe('repositories', () => {
  it('starts and finalizes a focus session with computed duration', () => {
    const id = repo.startFocusSession({ appName: 'Code', appPath: '/c', windowTitle: 'a.ts', pid: 10, startedAt: 1000, date: '2026-06-03' });
    repo.finalizeFocusSession(id, 6000);
    const rows = repo.getFocusSessions('2026-06-03');
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSec).toBe(5);
    expect(rows[0].endedAt).toBe(6000);
  });

  it('records app events and activity samples and lists available days', () => {
    repo.insertAppEvent({ appName: 'Code', appPath: '/c', pid: 10, type: 'opened', at: 1000, date: '2026-06-03' });
    repo.insertActivitySample({ bucketStart: 1000, bucketEnd: 61000, mouseMoves: 3, mouseDistancePx: 50, clicks: 1, scrolls: 0, keyEvents: 4, active: 1, appName: 'Code', date: '2026-06-03' });
    expect(repo.getActivitySamples('2026-06-03')).toHaveLength(1);
    expect(repo.getAvailableDays()).toEqual(['2026-06-03']);
  });

  it('clears all activity data', () => {
    repo.startFocusSession({ appName: 'Code', appPath: null, windowTitle: null, pid: 1, startedAt: 1, date: '2026-06-03' });
    repo.clearAll();
    expect(repo.getFocusSessions('2026-06-03')).toHaveLength(0);
  });
});
