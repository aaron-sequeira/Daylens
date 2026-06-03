import { describe, it, expect } from 'vitest';
import { isPidAlive, createPidWatcher } from './processLifecycle';

describe('process lifecycle', () => {
  it('reports the current process as alive and an impossible pid as dead', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2147483646)).toBe(false);
  });

  it('detects newly-dead pids via the watcher', () => {
    const alive = new Set([10, 20]);
    const w = createPidWatcher((pid) => alive.has(pid));
    w.track(10, 'Code');
    w.track(20, 'Chrome');
    expect(w.collectDead()).toEqual([]);
    alive.delete(20);
    expect(w.collectDead()).toEqual([{ pid: 20, appName: 'Chrome' }]);
    expect(w.collectDead()).toEqual([]);
  });
});
