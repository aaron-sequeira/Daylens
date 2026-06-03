import { describe, it, expect } from 'vitest';
import { computeDaySummary } from './rollup';
import type { FocusSessionRow, ActivitySampleRow } from '../../shared/types';

const fs = (o: Partial<FocusSessionRow>): FocusSessionRow => ({
  id: 1, appName: 'Code', appPath: null, windowTitle: null, pid: 1,
  startedAt: 0, endedAt: 0, durationSec: 0, date: '2026-06-03', ...o
});
const sample = (o: Partial<ActivitySampleRow>): ActivitySampleRow => ({
  id: 1, bucketStart: 0, bucketEnd: 60000, mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0,
  keyEvents: 0, active: 0, appName: 'Code', date: '2026-06-03', ...o
});

describe('computeDaySummary', () => {
  it('aggregates per-app time, sessions, first/last and totals', () => {
    const sessions = [
      fs({ id: 1, appName: 'Code', startedAt: 1000, endedAt: 4000, durationSec: 3 }),
      fs({ id: 2, appName: 'Code', startedAt: 5000, endedAt: 9000, durationSec: 4 }),
      fs({ id: 3, appName: 'Chrome', startedAt: 2000, endedAt: 4000, durationSec: 2 })
    ];
    const samples = [
      sample({ bucketStart: 0, bucketEnd: 60000, active: 1, appName: 'Code' }),
      sample({ bucketStart: 60000, bucketEnd: 120000, active: 0, appName: 'Code' })
    ];
    const out = computeDaySummary('2026-06-03', sessions, samples);
    expect(out.totalTrackedSec).toBe(9);
    expect(out.activeSec).toBe(60);
    expect(out.idleSec).toBe(0);
    const code = out.apps.find(a => a.appName === 'Code')!;
    expect(code.totalSec).toBe(7);
    expect(code.sessions).toBe(2);
    expect(code.firstOpenAt).toBe(1000);
    expect(code.lastCloseAt).toBe(9000);
    expect(code.activePct).toBe(50);
    expect(out.apps[0].appName).toBe('Code');
  });
});
