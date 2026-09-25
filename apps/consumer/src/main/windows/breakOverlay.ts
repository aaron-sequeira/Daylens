import { z } from 'zod';
import type { Rect } from '../coach/gate';

export const BREAK_SECONDS = { eye: 20, stretch: 120 } as const;
export type BreakKind = keyof typeof BREAK_SECONDS;

export interface BreakWindowLike {
  send(channel: string, payload?: unknown): void;
  close(): void;
  onReady(cb: () => void): void;
  focus(): void;
  /** Fires once if the window disappears from under the break (crash, failed load, or the
   * user closing it directly, e.g. Alt+F4) without the manager having closed it itself. */
  onGone(cb: () => void): void;
}

export const breakMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('done'), completed: z.boolean(), seconds: z.number().int().min(0).max(3600) }).strict(),
  z.object({ type: z.literal('extend') }).strict()
]);
export type BreakMessage = z.infer<typeof breakMessage>;

const WATCHDOG_SLACK_MS = 15_000;
const EXTEND_MS = 60_000;
const MAX_ALLOWANCE_S = 3600;

export function createBreakOverlay(deps: {
  displays(): { bounds: Rect; primary: boolean }[];
  makeWindow(bounds: Rect, primary: boolean): BreakWindowLike;
  onDone(r: { kind: BreakKind; seconds: number; completed: boolean }): void;
}) {
  let wins: BreakWindowLike[] = [];
  let kind: BreakKind | null = null;
  let startedAt = 0;
  let extendCount = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const elapsedSeconds = (): number => Math.round((Date.now() - startedAt) / 1000);

  // Ends the break exactly once: closes every window and reports the outcome upward.
  // Guarded by `kind` so a second trigger (a late `done`, another window going gone,
  // the watchdog) after the break has already ended is a no-op.
  const finish = (k: BreakKind, seconds: number, completed: boolean): void => {
    if (kind === null) return;
    kind = null;
    clearTimeout(watchdog);
    wins.forEach((w) => w.close());
    wins = [];
    deps.onDone({ kind: k, seconds, completed });
  };

  // Absolute deadline (not "allowance from now"): re-arming after an extend must push the
  // original deadline out by exactly 60s, not restart a fresh countdown from whenever the
  // extend happened to arrive.
  const armWatchdog = (k: BreakKind): void => {
    clearTimeout(watchdog);
    const deadline = startedAt + BREAK_SECONDS[k] * 1000 + extendCount * EXTEND_MS + WATCHDOG_SLACK_MS;
    watchdog = setTimeout(() => finish(k, elapsedSeconds(), false), Math.max(0, deadline - Date.now()));
  };

  return {
    start(k: BreakKind): boolean {
      if (kind !== null) return false;
      const displays = deps.displays();
      if (displays.length === 0) return false;
      kind = k;
      startedAt = Date.now();
      extendCount = 0;
      wins = [];
      armWatchdog(k);
      try {
        for (const { bounds, primary } of displays) {
          const w = deps.makeWindow(bounds, primary);
          // Pushed in before anything else can throw, so a later failure still knows
          // about (and can close) every window successfully made so far.
          wins.push(w);
          w.onReady(() => {
            w.send('break:start', { kind: k, seconds: BREAK_SECONDS[k] });
            if (primary) w.focus();
          });
          // Never trap the user behind a full-screen, always-on-top overlay: if any one
          // window goes away unexpectedly, end the break for all of them.
          w.onGone(() => finish(k, elapsedSeconds(), false));
        }
      } catch (e) {
        console.error('[break] window failed:', e);
        wins.forEach((w) => w.close());
        wins = [];
        kind = null;
        clearTimeout(watchdog);
        return false; // the break never really started: no onDone
      }
      return true;
    },
    active: (): boolean => kind !== null,
    handle(msg: BreakMessage): void {
      if (kind === null) return;
      if (msg.type === 'extend') {
        const nextAllowance = BREAK_SECONDS[kind] + (extendCount + 1) * 60 + WATCHDOG_SLACK_MS / 1000;
        if (nextAllowance > MAX_ALLOWANCE_S) return; // capped: ignore further extends
        extendCount++;
        wins.forEach((w) => w.send('break:extend'));
        armWatchdog(kind);
        return;
      }
      finish(kind, msg.seconds, msg.completed);
    }
  };
}
