import type { LabelStore } from '../screen/labels';
import { brainResponse, type BrainRequest } from './protocol';

export type LabellingState = 'waiting' | 'idle' | 'running' | 'paused' | 'deferred';
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
// Progress watchdog instead of a fixed batch timeout: slow CPUs can take many seconds per read, so a
// batch lives as long as results keep coming. Model load gets a longer allowance than the gap between reads.
export const LOAD_ALLOWANCE_MS = 90_000;
export const RESULT_GAP_MS = 60_000;
export const BACKLOG_LIMIT = 500;
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 3; // more than this within the window → paused
const EXIT_GRACE_MS = 1_000; // a clean exit may overtake the last messages
const POISON_FAILURES = 2; // failed batches a read may be first in line for before it is skipped

export function createLabelScheduler(deps: {
  store: LabelStore; fork(): BrainChild; modelReady(): boolean; modelDir: string; now(): number; onChange?(): void;
  canStart?(): boolean;
}): LabelScheduler {
  let running = false, paused = false, retryAt = 0, deferred = false;
  let failures: number[] = [];
  // In memory only: read id → failed batches it was the first unlabelled read of.
  const blamed = new Map<number, number>();
  const change = (): void => deps.onChange?.();

  const countFailure = (): void => {
    const now = deps.now();
    failures = [...failures.filter((t) => now - t < FAIL_WINDOW_MS), now];
    if (failures.length > MAX_FAILURES) paused = true;
    else retryAt = now + RETRY_DELAYS_MS[Math.min(failures.length, RETRY_DELAYS_MS.length) - 1];
  };

  /** One bad read (crashes or hangs the Brain) must not pause labelling for everything behind it. */
  const blame = (id: number): void => {
    const n = (blamed.get(id) ?? 0) + 1;
    if (n < POISON_FAILURES) { blamed.set(id, n); return; }
    blamed.delete(id);
    try {
      deps.store.markFailed(id, deps.now());
      console.warn('[brain] skipping read after 2 failed batches:', id); // id only, never text
    } catch (e) {
      console.error('[brain] marking a failed read failed:', e);
    }
  };

  function runBatch(): void {
    const reads = deps.store.unlabelled(BATCH_SIZE);
    const pending = new Set(reads.map((r) => r.id)); // batch ids that have no result stored yet
    let stored = 0;
    running = true;
    change();
    let child: BrainChild;
    try { child = deps.fork(); } catch { running = false; countFailure(); change(); return; }
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number): void => { clearTimeout(watchdog); watchdog = setTimeout(() => finish(false), ms); };
    // The Brain worker posts 'done' and exits only after its own fallback timer, so the scheduler
    // is responsible for killing the child itself as soon as a batch settles (every path below).
    const finish = (ok: boolean, readAtFault = true): void => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try { child.kill(); } catch { /* already exited: harmless */ }
      running = false;
      if (!ok) {
        const first = reads.find((r) => pending.has(r.id));
        if (first && readAtFault) blame(first.id);
        // Stored results are progress: the rest simply go in the next batch, with no backoff.
        if (stored === 0) countFailure();
      }
      change();
    };
    arm(LOAD_ALLOWANCE_MS);
    child.onMessage((m) => {
      if (settled) return;
      const r = brainResponse.safeParse(m);
      if (!r.success || r.data.op === 'error') { finish(false); return; }
      try {
        if (r.data.op === 'done') {
          deps.store.copyDupLabels(deps.now());
          finish(true);
          return;
        }
        // Never let the Brain write to a row outside the batch it was actually sent (or write one twice).
        const { result } = r.data;
        if (!pending.has(result.id)) return;
        deps.store.applyLabels([result], deps.now());
        pending.delete(result.id);
        stored++;
        arm(RESULT_GAP_MS);
        change();
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
    try { child.post({ op: 'label', modelDir: deps.modelDir, reads }); } catch { finish(false, false); }
  }

  return {
    tick() {
      if (running || paused) return;
      const now = deps.now();
      deps.store.markPurged(now);
      deps.store.copyDupLabels(now);
      if (!deps.modelReady() || now < retryAt) return;
      const { count, oldest } = deps.store.unlabelledSummary();
      if (count === 0) return;
      if (count < BATCH_MIN && now - (oldest ?? now) < MAX_WAIT_MS) return;
      const allowed = deps.canStart?.() ?? true;
      if (allowed !== !deferred) { deferred = !allowed; change(); }
      if (!allowed) return; // waiting for a quiet moment is never a failure
      runBatch();
    },
    status: () => ({
      state: paused ? 'paused' : running ? 'running' : !deps.modelReady() ? 'waiting' : deferred ? 'deferred' : 'idle',
      lastLabelledAt: deps.store.lastLabelledAt(),
      pending: deps.store.countUnlabelled()
    }),
    retry() { paused = false; failures = []; retryAt = 0; change(); },
    backlogBlocked: () => (paused || !deps.modelReady()) && deps.store.countUnlabelled() > BACKLOG_LIMIT
  };
}
