import type { LabelStore } from '../screen/labels';
import { brainResponse, type BrainRequest } from './protocol';

export type LabellingState = 'waiting' | 'idle' | 'running' | 'paused';
export interface LabellingStatus { state: LabellingState; lastLabelledAt: number | null; pending: number; }
export interface BrainChild {
  post(msg: BrainRequest): void;
  onMessage(cb: (m: unknown) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}
export interface LabelScheduler { tick(): void; status(): LabellingStatus; retry(): void; backlogBlocked(): boolean; }

export const BATCH_SIZE = 50;
export const BATCH_MIN = 20;
export const MAX_WAIT_MS = 10 * 60_000;
export const BATCH_TIMEOUT_MS = 120_000;
export const BACKLOG_LIMIT = 20;
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 3; // more than this within the window → paused
const EXIT_GRACE_MS = 1_000; // a clean exit may overtake the results message

export function createLabelScheduler(deps: {
  store: LabelStore; fork(): BrainChild; modelReady(): boolean; modelDir: string; now(): number; onChange?(): void;
}): LabelScheduler {
  let running = false, paused = false, retryAt = 0;
  let failures: number[] = [];
  const change = (): void => deps.onChange?.();

  const fail = (): void => {
    const now = deps.now();
    failures = [...failures.filter((t) => now - t < FAIL_WINDOW_MS), now];
    if (failures.length > MAX_FAILURES) paused = true;
    else retryAt = now + RETRY_DELAYS_MS[Math.min(failures.length, RETRY_DELAYS_MS.length) - 1];
  };

  function runBatch(): void {
    const reads = deps.store.unlabelled(BATCH_SIZE);
    const batchIds = new Set(reads.map((r) => r.id));
    running = true;
    change();
    let child: BrainChild;
    try { child = deps.fork(); } catch { running = false; fail(); change(); return; }
    let settled = false;
    // The Brain worker posts its result and exits only after its own fallback timer, so the scheduler
    // is responsible for killing the child itself as soon as a batch settles (every path below).
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited: harmless */ }
      running = false;
      if (!ok) fail();
      change();
    };
    const timer = setTimeout(() => finish(false), BATCH_TIMEOUT_MS);
    child.onMessage((m) => {
      if (settled) return;
      const r = brainResponse.safeParse(m);
      if (!r.success || r.data.op === 'error') { finish(false); return; }
      try {
        const now = deps.now();
        // Never let the Brain write to a row outside the batch it was actually sent.
        const results = r.data.results.filter((x) => batchIds.has(x.id));
        deps.store.applyLabels(results, now);
        deps.store.copyDupLabels(now);
        finish(true);
      } catch (e) {
        // SQLITE_BUSY, disk full, etc.: this listener runs inside the utilityProcess 'message'
        // handler, so an uncaught exception here would escape into the main process.
        console.error('[brain] storing labels failed:', e);
        finish(false);
      }
    });
    child.onExit((code) => {
      if (code === 0) setTimeout(() => finish(false), EXIT_GRACE_MS);
      else finish(false);
    });
    try { child.post({ op: 'label', modelDir: deps.modelDir, reads }); } catch { finish(false); }
  }

  return {
    tick() {
      if (running || paused) return;
      const now = deps.now();
      deps.store.markPurged(now);
      deps.store.copyDupLabels(now);
      if (!deps.modelReady() || now < retryAt) return;
      const pending = deps.store.countUnlabelled();
      if (pending === 0) return;
      const oldest = deps.store.oldestUnlabelledAt() ?? now;
      if (pending < BATCH_MIN && now - oldest < MAX_WAIT_MS) return;
      runBatch();
    },
    status: () => ({
      state: paused ? 'paused' : running ? 'running' : deps.modelReady() ? 'idle' : 'waiting',
      lastLabelledAt: deps.store.lastLabelledAt(),
      pending: deps.store.countUnlabelled()
    }),
    retry() { paused = false; failures = []; retryAt = 0; change(); },
    backlogBlocked: () => (paused || !deps.modelReady()) && deps.store.countUnlabelled() > BACKLOG_LIMIT
  };
}
