import type { ForegroundInfo } from '../../shared/types';
import type { ForegroundSource } from './types';

type ActiveWinFn = () => Promise<{ title?: string; owner: { name: string; path?: string; processId: number } } | undefined>;
let activeWin: ActiveWinFn | null = null;

async function load(): Promise<ActiveWinFn> {
  if (!activeWin) { const m = await import('active-win'); activeWin = m.default as unknown as ActiveWinFn; }
  return activeWin;
}

export class ActiveWinForegroundSource implements ForegroundSource {
  private warned = false;
  async get(): Promise<ForegroundInfo | null> {
    try {
      const fn = await load();
      const r = await fn();
      if (!r) return null;
      return { appName: r.owner.name, appPath: r.owner.path ?? null, title: r.title ?? null, pid: r.owner.processId };
    } catch (e) {
      // Surface the first failure: a swallowed error here (e.g. a missing packaged dependency)
      // means foreground lookups always return null and nothing is ever tracked.
      if (!this.warned) { this.warned = true; console.error('[ActiveWinForegroundSource] foreground lookup failed; tracking will be empty:', e); }
      return null;
    }
  }
}
