import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../db/schema';
import { createRepositories, Repositories } from '../db/repositories';
import { createTracker, Tracker } from './tracker';
import type { ForegroundInfo, InputCounts } from '../types';
import { localDate } from '../date';

let repo: Repositories;
let nowMs: number;
let foreground: ForegroundInfo | null;
let drained: InputCounts;
let alivePids: Set<number>;
let systemIdleSec: number;
let tracker: Tracker;

const blank = (): InputCounts => ({ mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 });

beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  repo = createRepositories(db);
  nowMs = 1_000_000;
  foreground = null;
  drained = blank();
  alivePids = new Set([10, 20]);
  systemIdleSec = 0;
  tracker = createTracker({
    foreground: { get: async () => foreground },
    input: { start() {}, stop() {}, drain: () => drained },
    clock: { now: () => nowMs },
    repo,
    getSettings: () => ({ idleThresholdSec: 60, captureWindowTitles: true, pollIntervalMs: 2000, bucketSizeSec: 60, trackingPaused: false }),
    getSystemIdleSec: () => systemIdleSec,
    isPidAlive: (pid) => alivePids.has(pid)
  });
});

describe('tracker', () => {
  it('opens a session and an opened event on first foreground app', async () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    expect(repo.getFocusSessions(day)).toHaveLength(1);
    expect(repo.getAppEvents(day).some(e => e.type === 'opened' && e.appName === 'Code')).toBe(true);
  });

  it('finalizes the previous session with a duration when the app changes', async () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    nowMs += 5000;
    foreground = { appName: 'Chrome', appPath: '/ch', title: 'tab', pid: 20 };
    await tracker.tick();
    const rows = repo.getFocusSessions(day);
    expect(rows).toHaveLength(2);
    expect(rows[0].durationSec).toBe(5);
    expect(rows[1].endedAt).toBeNull();
  });

  it('emits a closed event when a tracked pid dies', async () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    alivePids.delete(10);
    nowMs += 2000;
    foreground = { appName: 'Chrome', appPath: '/ch', title: 'tab', pid: 20 };
    await tracker.tick();
    const events = repo.getAppEvents(day);
    expect(events.some(e => e.type === 'closed' && e.appName === 'Code')).toBe(true);
  });

  it('writes an active sample when input occurred and inactive when idle', () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    drained = { ...blank(), clicks: 3 };
    tracker.flushBucket();
    let samples = repo.getActivitySamples(day);
    expect(samples).toHaveLength(1);
    expect(samples[0].active).toBe(1);

    drained = blank();
    systemIdleSec = 120;
    nowMs += 60000;
    tracker.flushBucket();
    samples = repo.getActivitySamples(day);
    expect(samples[1].active).toBe(0);
  });

  it('emits a fresh opened event when a pid is reused after closing', async () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    alivePids.delete(10);
    nowMs += 1000;
    foreground = { appName: 'Chrome', appPath: '/ch', title: 'tab', pid: 20 };
    await tracker.tick();
    alivePids.add(10); // OS reuses pid 10 for a different app
    nowMs += 1000;
    foreground = { appName: 'Slack', appPath: '/s', title: 'general', pid: 10 };
    await tracker.tick();
    const opened = repo.getAppEvents(day).filter(e => e.type === 'opened');
    expect(opened.some(e => e.appName === 'Slack')).toBe(true);
  });

  it('finalizes the open session and flushes a final bucket on stop', async () => {
    const day = localDate(nowMs);
    foreground = { appName: 'Code', appPath: '/c', title: 'a.ts', pid: 10 };
    await tracker.tick();
    nowMs += 30000;
    drained = { ...blank(), keyEvents: 5 };
    tracker.stop();
    const rows = repo.getFocusSessions(day);
    expect(rows[0].endedAt).toBe(nowMs);
    expect(rows[0].durationSec).toBe(30);
    expect(repo.getActivitySamples(day)).toHaveLength(1);
  });

  it('start() is idempotent: a second start does not stack timers, and stop() clears them all', () => {
    vi.useFakeTimers();
    try {
      tracker.start();
      tracker.start(); // resume-while-running must be a no-op, not a second poll+bucket pair
      expect(vi.getTimerCount()).toBe(2); // exactly poll + bucket (would be 4 if start() leaked)
      tracker.stop();
      expect(vi.getTimerCount()).toBe(0); // no orphaned interval survives stop()
    } finally {
      vi.useRealTimers();
    }
  });
});
