import type { TrackerSettings } from '../types';
import type { Repositories } from '../db/repositories';
import type { ForegroundSource, InputSource, Clock } from './types';
import { isActiveBucket } from './idle';
import { createPidWatcher, isPidAlive } from './processLifecycle';
import { localDate } from '../date';

export interface TrackerDeps {
  foreground: ForegroundSource;
  input: InputSource;
  clock: Clock;
  repo: Repositories;
  getSettings: () => TrackerSettings;
  getSystemIdleSec: () => number;
  isPidAlive?: (pid: number) => boolean;
  onUpdate?: () => void;
}

export interface Tracker {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  flushBucket(): void;
  status(): { paused: boolean; currentApp: string | null; sessionStartedAt: number | null };
}

const dateOf = (ms: number): string => localDate(ms);

export function createTracker(deps: TrackerDeps): Tracker {
  const aliveFn = deps.isPidAlive ?? isPidAlive;
  const watcher = createPidWatcher(aliveFn);
  let current: { id: number; appName: string; pid: number; title: string | null; startedAt: number } | null = null;
  let lastBucketEnd = deps.clock.now();
  let pollTimer: NodeJS.Timeout | null = null;
  let bucketTimer: NodeJS.Timeout | null = null;
  const openedPids = new Set<number>();

  const changed = (fgApp: string, fgPid: number, fgTitle: string | null): boolean =>
    !current || current.appName !== fgApp || current.pid !== fgPid || current.title !== fgTitle;

  const finalizeCurrent = (at: number): void => {
    if (current) { deps.repo.finalizeFocusSession(current.id, at); current = null; }
  };

  // Returns true if this pid has already produced an 'opened' event; otherwise records it as seen.
  function alreadyOpened(pid: number): boolean {
    if (openedPids.has(pid)) return true;
    openedPids.add(pid);
    return false;
  }

  async function tick(): Promise<void> {
    const now = deps.clock.now();
    const fg = await deps.foreground.get();

    for (const dead of watcher.collectDead()) {
      deps.repo.insertAppEvent({ appName: dead.appName, appPath: null, pid: dead.pid, type: 'closed', at: now, date: dateOf(now) });
      openedPids.delete(dead.pid); // allow a fresh 'opened' if the OS later reuses this pid
    }
    if (!fg) return;

    // Compare the title as stored: with titles off, current.title is null, so comparing the raw title would split every poll.
    const title = deps.getSettings().captureWindowTitles ? fg.title : null;
    if (changed(fg.appName, fg.pid, title)) {
      finalizeCurrent(now);
      if (!alreadyOpened(fg.pid)) {
        deps.repo.insertAppEvent({ appName: fg.appName, appPath: fg.appPath, pid: fg.pid, type: 'opened', at: now, date: dateOf(now) });
      }
      watcher.track(fg.pid, fg.appName);
      const id = deps.repo.startFocusSession({ appName: fg.appName, appPath: fg.appPath, windowTitle: title, pid: fg.pid, startedAt: now, date: dateOf(now) });
      current = { id, appName: fg.appName, pid: fg.pid, title, startedAt: now };
      deps.onUpdate?.();
    }
  }

  function flushBucket(): void {
    const now = deps.clock.now();
    const counts = deps.input.drain();
    const settings = deps.getSettings();
    const active: 0 | 1 = isActiveBucket(counts, deps.getSystemIdleSec(), settings.idleThresholdSec) ? 1 : 0;
    // MVP: the whole bucket is attributed to the app focused at flush time (bucket-granularity).
    deps.repo.insertActivitySample({
      bucketStart: lastBucketEnd, bucketEnd: now,
      mouseMoves: counts.mouseMoves, mouseDistancePx: counts.mouseDistancePx, clicks: counts.clicks,
      scrolls: counts.scrolls, keyEvents: counts.keyEvents, active, appName: current?.appName ?? null, date: dateOf(now)
    });
    lastBucketEnd = now;
    deps.onUpdate?.();
  }

  return {
    start() {
      if (pollTimer) return; // idempotent: don't stack a second set of timers (resume-while-running would leak the old ones)
      deps.input.start();
      const s = deps.getSettings();
      lastBucketEnd = deps.clock.now();
      pollTimer = setInterval(() => { void tick(); }, s.pollIntervalMs);
      bucketTimer = setInterval(() => flushBucket(), s.bucketSizeSec * 1000);
    },
    stop() {
      if (!pollTimer) return; // idempotent: a stopped tracker must not flush a bucket spanning the paused/pre-consent time
      clearInterval(pollTimer);
      if (bucketTimer) clearInterval(bucketTimer);
      pollTimer = bucketTimer = null;
      if (deps.clock.now() > lastBucketEnd) flushBucket(); // capture the in-progress bucket so the last interval isn't lost
      finalizeCurrent(deps.clock.now());
      deps.input.stop();
    },
    tick,
    flushBucket,
    status() {
      return { paused: deps.getSettings().trackingPaused, currentApp: current?.appName ?? null, sessionStartedAt: current?.startedAt ?? null };
    }
  };
}
