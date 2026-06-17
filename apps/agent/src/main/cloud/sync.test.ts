import { describe, it, expect } from 'vitest';
import { mapDaySummaryToRow, recentDates, syncWindow } from './sync';
import type { DaySummary } from '../../shared/types';

const summary: DaySummary = {
  date: '2026-06-17', totalTrackedSec: 7200, activeSec: 3600, idleSec: 3600,
  apps: [{ appName: 'Code', totalSec: 5000, sessions: 3, firstOpenAt: 1, lastCloseAt: 2, activePct: 80 }]
};

describe('mapDaySummaryToRow', () => {
  it('maps to a snake_case row and drops firstOpen/lastClose', () => {
    expect(mapDaySummaryToRow('u1', summary)).toEqual({
      user_id: 'u1', date: '2026-06-17', total_tracked_sec: 7200, active_sec: 3600, idle_sec: 3600,
      by_app: [{ app_name: 'Code', total_sec: 5000, sessions: 3, active_pct: 80 }]
    });
  });
  it('clamps negatives to zero', () => {
    const r = mapDaySummaryToRow('u1', { ...summary, idleSec: -5, apps: [] });
    expect(r.idle_sec).toBe(0);
  });
});

describe('recentDates', () => {
  it('returns windowDays local dates ending today (oldest first)', () => {
    const r = recentDates(3, Date.parse('2026-06-17T12:00:00'));
    expect(r).toHaveLength(3);
    expect(r[2]).toBe('2026-06-17');
    expect(r[0]).toBe('2026-06-15');
  });
});

describe('syncWindow', () => {
  const baseDeps = {
    userId: 'u1', windowDays: 2, now: () => Date.parse('2026-06-17T12:00:00'),
    repo: { getFocusSessions: () => [], getActivitySamples: () => [] }
  };

  it('upserts one row per day with a valid token', async () => {
    let upserted: unknown[] = [];
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => 'AT',
      upsert: async (_t, rows) => { upserted = rows; return { ok: true }; }
    });
    expect('syncedDays' in r && r.syncedDays).toBe(2);
    expect(upserted).toHaveLength(2);
  });

  it('errors (no upsert) when there is no valid token', async () => {
    let called = false;
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => null,
      upsert: async () => { called = true; return { ok: true }; }
    });
    expect(r).toEqual({ error: 'not signed in' });
    expect(called).toBe(false);
  });

  it('propagates an upsert error', async () => {
    const r = await syncWindow({
      ...baseDeps,
      getValidAccessToken: async () => 'AT',
      upsert: async () => ({ error: 'permission denied' })
    });
    expect(r).toEqual({ error: 'permission denied' });
  });
});
