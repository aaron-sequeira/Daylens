import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBreakOverlay, type BreakWindowLike } from './breakOverlay';

class FakeWin implements BreakWindowLike {
  sent: [string, unknown][] = []; closed = false; focused = false;
  private r: (() => void) | null = null;
  private gone: (() => void) | null = null;
  send(c: string, p?: unknown) { this.sent.push([c, p]); }
  close() { this.closed = true; }
  onReady(cb: () => void) { this.r = cb; }
  onGone(cb: () => void) { this.gone = cb; }
  focus() { this.focused = true; }
  ready() { this.r?.(); }
  goAway() { this.gone?.(); }
}

describe('break overlay', () => {
  it('opens one window per display, starts them, focuses the primary', () => {
    const wins: FakeWin[] = [];
    const o = createBreakOverlay({
      displays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }, { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, primary: false }],
      makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: () => {}
    });
    expect(o.start('eye')).toBe(true);
    wins.forEach((w) => w.ready());
    expect(wins.map((w) => w.sent[0])).toEqual([['break:start', { kind: 'eye', seconds: 20 }], ['break:start', { kind: 'eye', seconds: 20 }]]);
    expect(wins[0].focused).toBe(true);
    expect(o.start('eye')).toBe(false); // already running
  });

  it('broadcasts +1 min and closes all on done, reporting once', () => {
    const wins: FakeWin[] = []; const done: unknown[] = [];
    const o = createBreakOverlay({ displays: () => [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, primary: true }, { bounds: { x: 1, y: 0, width: 1, height: 1 }, primary: false }],
      makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: (r) => done.push(r) });
    o.start('stretch');
    o.handle({ type: 'extend' });
    expect(wins.every((w) => w.sent.some(([c]) => c === 'break:extend'))).toBe(true);
    o.handle({ type: 'done', completed: true, seconds: 180 });
    o.handle({ type: 'done', completed: true, seconds: 180 });
    expect(wins.every((w) => w.closed)).toBe(true);
    expect(done).toEqual([{ kind: 'stretch', seconds: 180, completed: true }]);
    expect(o.active()).toBe(false);
  });

  it('a secondary window going gone closes all windows and reports completed:false once', () => {
    const wins: FakeWin[] = []; const done: unknown[] = [];
    const o = createBreakOverlay({
      displays: () => [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, primary: true }, { bounds: { x: 1, y: 0, width: 1, height: 1 }, primary: false }],
      makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: (r) => done.push(r)
    });
    o.start('eye');
    wins[1].goAway();
    expect(wins.every((w) => w.closed)).toBe(true);
    expect(done).toEqual([{ kind: 'eye', seconds: 0, completed: false }]);
    expect(o.active()).toBe(false);
    // A late done arriving after the window already went gone must be ignored.
    o.handle({ type: 'done', completed: true, seconds: 999 });
    expect(done).toEqual([{ kind: 'eye', seconds: 0, completed: false }]);
  });

  describe('watchdog', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fires after the allowance, and extend pushes it out by 60s', () => {
      const wins: FakeWin[] = []; const done: unknown[] = [];
      const o = createBreakOverlay({
        displays: () => [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, primary: true }],
        makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, onDone: (r) => done.push(r)
      });
      o.start('eye'); // eye = 20s, +15s slack = 35s allowance
      vi.advanceTimersByTime(34_000);
      expect(o.active()).toBe(true);
      expect(done).toEqual([]);
      o.handle({ type: 'extend' }); // pushes the watchdog out by 60s
      vi.advanceTimersByTime(34_000); // 68s total; still within the extended 95s allowance
      expect(o.active()).toBe(true);
      vi.advanceTimersByTime(61_000); // 129s total; past the 95s allowance
      expect(o.active()).toBe(false);
      expect(done).toEqual([{ kind: 'eye', seconds: 129, completed: false }]);
      expect(wins.every((w) => w.closed)).toBe(true);
      // A late done arriving after the watchdog already ended the break must be ignored.
      o.handle({ type: 'done', completed: true, seconds: 999 });
      expect(done).toEqual([{ kind: 'eye', seconds: 129, completed: false }]);
    });
  });
});
