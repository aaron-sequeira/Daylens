export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface PidWatcher {
  track(pid: number, appName: string): void;
  collectDead(): { pid: number; appName: string }[];
}

export function createPidWatcher(aliveFn: (pid: number) => boolean = isPidAlive): PidWatcher {
  const tracked = new Map<number, string>();
  return {
    track(pid, appName) { if (pid > 0) tracked.set(pid, appName); },
    collectDead() {
      const dead: { pid: number; appName: string }[] = [];
      for (const [pid, appName] of tracked) {
        if (!aliveFn(pid)) { dead.push({ pid, appName }); tracked.delete(pid); }
      }
      return dead;
    }
  };
}
