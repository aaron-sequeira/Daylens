/**
 * Pure stack bookkeeping for the pill page: which live cards to expire on overflow,
 * their depth/open layout, remaining auto-hide time, and whether the behind cards can
 * fan out without any part leaving the 400x260 window. Kept dependency-free (no DOM,
 * no timers, no Electron) so it's unit-testable everywhere.
 */

export const MAX_CARDS = 3;
export const OPEN_AFTER_MS = 700;
export const AUTO_HIDE_MS = 8000;

export const PILL_TOP = 18;
export const PILL_COLLAPSED_H = 46;
export const PILL_OPEN_H = 204;
export const PILL_OPEN_FEWER_H = 226;
export const STACK_H = 260;
export const FAN_GAP = 8;

export interface StackEntry {
  id: number;
  done: boolean;
}

/** Cards still visible (not mid dismiss-out animation). */
export function liveEntries<T extends StackEntry>(entries: T[]): T[] {
  return entries.filter((e) => !e.done);
}

/**
 * Which LIVE cards must be expired to keep at most `max` live at once — the oldest
 * live ones first (`entries` given oldest-first). A done (fading) card never counts
 * against the limit and is never returned, so a 4th *live* card expires exactly the
 * oldest live one even while an older card is still fading out.
 */
export function overflow<T extends StackEntry>(entries: T[], max: number): T[] {
  const live = liveEntries(entries);
  return live.slice(0, Math.max(0, live.length - max));
}

export interface LayoutEntry extends StackEntry {
  openReady: boolean;
}
export interface LayoutResult {
  id: number;
  depth: number;
  open: boolean;
}

/**
 * Depth (0 = front/newest) and whether each LIVE card should carry the `open` class.
 * Only the front card can be visually open; a behind card keeps its own `openReady`
 * flag, so it opens immediately (no extra delay) once promoted to front. Done cards
 * are left out of the result entirely — the page keeps whatever classes they had.
 */
export function computeLayout(entries: LayoutEntry[]): LayoutResult[] {
  const live = liveEntries(entries);
  return live.map((e, i) => {
    const depth = live.length - 1 - i;
    return { id: e.id, depth, open: depth === 0 && e.openReady };
  });
}

/** Time left in an auto-hide countdown after `elapsedMs` have passed. Clamped to 0. */
export function tickDown(remainingMs: number, elapsedMs: number): number {
  return Math.max(0, remainingMs - elapsedMs);
}

/**
 * Whether `behindCount` collapsed (46px) pills can fan out below a front card of
 * `frontHeightPx` without any part extending past the 260px stack. Only possible
 * while the front card is still collapsed — an open front card (204/226px) leaves
 * no room, so behind cards stay a compact peek instead.
 */
export function canFan(frontHeightPx: number, behindCount: number): boolean {
  if (behindCount <= 0) return true;
  const needed = PILL_TOP + frontHeightPx + behindCount * (FAN_GAP + PILL_COLLAPSED_H);
  return needed <= STACK_H;
}

/**
 * A card's auto-hide countdown: how much time is left, and whether it's currently
 * ticking down. Pure state so the "does hover actually pause it" logic is testable
 * without a real timer or clock.
 */
export interface AutoHideState {
  remainingMs: number;
  running: boolean;
}

/**
 * Arms a fresh countdown for `totalMs`. If the card opens while already hovered, it
 * starts paused at the full time instead of ticking down under the cursor.
 */
export function arm(totalMs: number, hovering: boolean): AutoHideState {
  return { remainingMs: totalMs, running: !hovering };
}

/** Stops the countdown and stores what's left after `elapsedMs` have ticked by. No-op if already paused. */
export function pause(state: AutoHideState, elapsedMs: number): AutoHideState {
  if (!state.running) return state;
  return { remainingMs: tickDown(state.remainingMs, elapsedMs), running: false };
}

/** Resumes ticking down from the stored remaining time (unchanged). No-op if already running. */
export function resume(state: AutoHideState): AutoHideState {
  if (state.running) return state;
  return { ...state, running: true };
}
