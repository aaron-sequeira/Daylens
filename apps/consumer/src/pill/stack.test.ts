import { describe, it, expect } from 'vitest';
import { overflow, computeLayout, tickDown, canFan, arm, pause, resume, PILL_OPEN_H, PILL_OPEN_FEWER_H, PILL_COLLAPSED_H } from './stack';

describe('overflow', () => {
  it('expires exactly the oldest live card when a 4th live card arrives', () => {
    const entries = [{ id: 1, done: false }, { id: 2, done: false }, { id: 3, done: false }, { id: 4, done: false }];
    expect(overflow(entries, 3)).toEqual([{ id: 1, done: false }]);
  });
  it('does not count a fading (done) card against the limit', () => {
    const entries = [{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: false }, { id: 4, done: false }];
    expect(overflow(entries, 3)).toEqual([]);
  });
  it('returns nothing when at or under the limit', () => {
    expect(overflow([{ id: 1, done: false }, { id: 2, done: false }], 3)).toEqual([]);
  });
});

describe('computeLayout', () => {
  it('only the front (last, live) card can be open, and only if its own openReady is true', () => {
    const r = computeLayout([
      { id: 1, done: false, openReady: true },
      { id: 2, done: false, openReady: true }
    ]);
    expect(r).toEqual([
      { id: 1, depth: 1, open: false },
      { id: 2, depth: 0, open: true }
    ]);
  });
  it('front card is not open yet if its own openReady is still false', () => {
    expect(computeLayout([{ id: 1, done: false, openReady: false }])).toEqual([{ id: 1, depth: 0, open: false }]);
  });
  it('excludes done cards, and a promoted card opens immediately if it was already openReady', () => {
    const r = computeLayout([
      { id: 1, done: true, openReady: true },
      { id: 2, done: false, openReady: true }
    ]);
    expect(r).toEqual([{ id: 2, depth: 0, open: true }]);
  });
});

describe('tickDown', () => {
  it('subtracts elapsed time', () => { expect(tickDown(8000, 3000)).toBe(5000); });
  it('clamps at 0', () => { expect(tickDown(1000, 5000)).toBe(0); });
});

describe('canFan', () => {
  it('fits when nothing is behind', () => { expect(canFan(PILL_OPEN_H, 0)).toBe(true); });
  it('does not fit below an open front card', () => { expect(canFan(PILL_OPEN_H, 1)).toBe(false); });
  it('does not fit below an open (fewer) front card either', () => { expect(canFan(PILL_OPEN_FEWER_H, 1)).toBe(false); });
  it('fits below a still-collapsed front card', () => { expect(canFan(PILL_COLLAPSED_H, 2)).toBe(true); });
});

describe('auto-hide state (arm/pause/resume)', () => {
  it('arms the full time and starts running when not hovering', () => {
    expect(arm(8000, false)).toEqual({ remainingMs: 8000, running: true });
  });
  it('arm while hovered stays paused, at the full time', () => {
    expect(arm(8000, true)).toEqual({ remainingMs: 8000, running: false });
  });
  it('pause stores the remaining time and stops running', () => {
    expect(pause({ remainingMs: 8000, running: true }, 3000)).toEqual({ remainingMs: 5000, running: false });
  });
  it('pause is a no-op if already not running', () => {
    const s = { remainingMs: 5000, running: false };
    expect(pause(s, 3000)).toEqual(s);
  });
  it('resume re-arms with the stored remaining time, unchanged', () => {
    expect(resume({ remainingMs: 5000, running: false })).toEqual({ remainingMs: 5000, running: true });
  });
  it('resume is a no-op if already running', () => {
    const s = { remainingMs: 5000, running: true };
    expect(resume(s)).toEqual(s);
  });
});
