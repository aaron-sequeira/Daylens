import { z } from 'zod';
import type { Rect } from '../coach/gate';
import type { Animation } from '../../shared/reminders';

export interface BreakSpec { label: string; animation: Animation; seconds: number; title: string; text: string; doneLabel?: string; reminderId?: number; }
export const LONG_BREAK_S = 300;
export const PRESETS = {
  eye: { label: 'eye', animation: 'eyes', seconds: 20, title: 'Look at something far away', text: 'At least 6 metres, like a window, a wall across the room, or the sky.' },
  stretch: { label: 'stretch', animation: 'stretch', seconds: 120, title: 'Stand up and stretch', text: 'Roll your shoulders, reach up, and take a few slow breaths.' }
} satisfies Record<string, BreakSpec>;

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
  onDone(r: { spec: BreakSpec; seconds: number; completed: boolean }): void;
}) {
  let wins: BreakWindowLike[] = [];
  let spec: BreakSpec | null = null;
  let startedAt = 0;
  let extendCount = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const elapsedSeconds = (): number => Math.round((Date.now() - startedAt) / 1000);

  // Ends the break exactly once: closes every window and reports the outcome upward.
  // Guarded by `spec` so a second trigger (a late `done`, another window going gone,
  // the watchdog) after the break has already ended is a no-op.
  const finish = (s: BreakSpec, seconds: number, completed: boolean): void => {
    if (spec === null) return;
    spec = null;
    clearTimeout(watchdog);
    wins.forEach((w) => w.close());
    wins = [];
    deps.onDone({ spec: s, seconds, completed });
  };

  // Absolute deadline (not "allowance from now"): re-arming after an extend must push the
  // original deadline out by exactly 60s, not restart a fresh countdown from whenever the
  // extend happened to arrive.
  const armWatchdog = (s: BreakSpec): void => {
    clearTimeout(watchdog);
    const deadline = startedAt + s.seconds * 1000 + extendCount * EXTEND_MS + WATCHDOG_SLACK_MS;
    watchdog = setTimeout(() => {
      const elapsed = elapsedSeconds();
      const completed = s.seconds >= LONG_BREAK_S && elapsed >= s.seconds / 2;
      finish(s, elapsed, completed);
    }, Math.max(0, deadline - Date.now()));
  };

  return {
    start(s: BreakSpec): boolean {
      if (spec !== null) return false;
      const displays = deps.displays();
      if (displays.length === 0) return false;
      spec = s;
      startedAt = Date.now();
      extendCount = 0;
      wins = [];
      armWatchdog(s);
      try {
        for (const { bounds, primary } of displays) {
          const w = deps.makeWindow(bounds, primary);
          // Pushed in before anything else can throw, so a later failure still knows
          // about (and can close) every window successfully made so far.
          wins.push(w);
          w.onReady(() => {
            w.send('break:start', {
              animation: s.animation, seconds: s.seconds, title: s.title, text: s.text, long: s.seconds >= LONG_BREAK_S,
              ...(s.doneLabel ? { doneLabel: s.doneLabel } : {})
            });
            if (primary) w.focus();
          });
          // Never trap the user behind a full-screen, always-on-top overlay: if any one
          // window goes away unexpectedly, end the break for all of them.
          w.onGone(() => finish(s, elapsedSeconds(), false));
        }
      } catch (e) {
        console.error('[break] window failed:', e);
        wins.forEach((w) => w.close());
        wins = [];
        spec = null;
        clearTimeout(watchdog);
        return false; // the break never really started: no onDone
      }
      return true;
    },
    active: (): boolean => spec !== null,
    handle(msg: BreakMessage): void {
      if (spec === null) return;
      if (msg.type === 'extend') {
        if (spec.seconds >= LONG_BREAK_S) return; // long breaks can't be extended
        const nextAllowance = spec.seconds + (extendCount + 1) * 60 + WATCHDOG_SLACK_MS / 1000;
        if (nextAllowance > MAX_ALLOWANCE_S) return; // capped: ignore further extends
        extendCount++;
        wins.forEach((w) => w.send('break:extend'));
        armWatchdog(spec);
        return;
      }
      finish(spec, msg.seconds, msg.completed);
    }
  };
}
