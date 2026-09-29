import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBreakOverlay, PRESETS, type BreakWindowLike } from './breakOverlay';

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

// Shared harness: one primary + one secondary display, tracking sent messages and onDone reports.
function harness() {
  const wins: FakeWin[] = [];
  const done: unknown[] = [];
  const overlay = createBreakOverlay({
    displays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }, { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, primary: false }],
    makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; },
    onDone: (r) => done.push(r)
  });
  return { overlay, wins, done, readyAll: () => wins.forEach((w) => w.ready()), get sent() { return wins.map((w) => w.sent[0]); } };
}

describe('break overlay', () => {
  it('opens one window per display, starts them, focuses the primary', () => {
    const t = harness();
    expect(t.overlay.start(PRESETS.eye)).toBe(true);
    t.readyAll();
    expect(t.sent).toEqual([
      ['break:start', { animation: 'eyes', seconds: 20, title: PRESETS.eye.title, text: PRESETS.eye.text, long: false }],
      ['break:start', { animation: 'eyes', seconds: 20, title: PRESETS.eye.title, text: PRESETS.eye.text, long: false }]
    ]);
    expect(t.wins[0].focused).toBe(true);
    expect(t.overlay.start(PRESETS.eye)).toBe(false); // already running
  });

  it('sends the spec to every window, with long = seconds >= 300', () => {
    const t = harness();
    const spec = { label: 'reminder:2', animation: 'meal' as const, seconds: 1800, title: 'Lunch time 🍱', text: 'Enjoy it.', reminderId: 2 };
    t.overlay.start(spec);
    t.readyAll();
    expect(t.sent[0]).toEqual(['break:start', { animation: 'meal', seconds: 1800, title: 'Lunch time 🍱', text: 'Enjoy it.', long: true }]);
  });

  it('broadcasts +1 min and closes all on done, reporting once', () => {
    const t = harness();
    t.overlay.start(PRESETS.stretch);
    t.overlay.handle({ type: 'extend' });
    expect(t.wins.every((w) => w.sent.some(([c]) => c === 'break:extend'))).toBe(true);
    t.overlay.handle({ type: 'done', completed: true, seconds: 180 });
    t.overlay.handle({ type: 'done', completed: true, seconds: 180 });
    expect(t.wins.every((w) => w.closed)).toBe(true);
    expect(t.done).toEqual([{ spec: PRESETS.stretch, seconds: 180, completed: true }]);
    expect(t.overlay.active()).toBe(false);
  });

  it('a secondary window going gone closes all windows and reports completed:false once', () => {
    const t = harness();
    t.overlay.start(PRESETS.eye);
    t.wins[1].goAway();
    expect(t.wins.every((w) => w.closed)).toBe(true);
    expect(t.done).toEqual([{ spec: PRESETS.eye, seconds: 0, completed: false }]);
    expect(t.overlay.active()).toBe(false);
    // A late done arriving after the window already went gone must be ignored.
    t.overlay.handle({ type: 'done', completed: true, seconds: 999 });
    expect(t.done).toEqual([{ spec: PRESETS.eye, seconds: 0, completed: false }]);
  });

  describe('watchdog', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fires after the allowance, measured from the absolute deadline (not re-armed relative to now)', () => {
      const t = harness();
      t.overlay.start(PRESETS.eye); // eye = 20s, +15s slack = 35s allowance from t=0
      vi.advanceTimersByTime(10_000); // t=10s
      t.overlay.handle({ type: 'extend' }); // extendCount=1: absolute deadline becomes t=0+(20+60+15)s = t=95s.
      // Under a buggy relative re-arm (35s/95s counted fresh from "now"=10s), the deadline
      // would land at t=105s instead — this window (94.999s vs 95.001s) would not catch that bug.
      vi.advanceTimersByTime(84_999); // t=94.999s: still just under the t=95s deadline
      expect(t.overlay.active()).toBe(true);
      vi.advanceTimersByTime(2); // t=95.001s: just past the t=95s deadline
      expect(t.overlay.active()).toBe(false);
      expect(t.done).toEqual([{ spec: PRESETS.eye, seconds: 95, completed: false }]);
      expect(t.wins.every((w) => w.closed)).toBe(true);
      // A late done arriving after the watchdog already ended the break must be ignored.
      t.overlay.handle({ type: 'done', completed: true, seconds: 999 });
      expect(t.done).toEqual([{ spec: PRESETS.eye, seconds: 95, completed: false }]);
    });

    it('leaves no pending timers after a normal done', () => {
      const t = harness();
      t.overlay.start(PRESETS.eye);
      expect(vi.getTimerCount()).toBeGreaterThan(0); // the watchdog is armed
      t.overlay.handle({ type: 'done', completed: true, seconds: 20 });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores extend once the total allowance would pass 3600s', () => {
      const t = harness();
      t.overlay.start(PRESETS.stretch); // 120s
      // Allowance = 120 + 60*extends + 15. At extends=58 that's 3615s (>3600): the 58th extend must be ignored.
      for (let i = 0; i < 57; i++) t.overlay.handle({ type: 'extend' });
      t.wins[0].sent = [];
      t.overlay.handle({ type: 'extend' }); // the 58th: must be ignored (no broadcast)
      expect(t.wins[0].sent).toEqual([]);
      expect(t.overlay.active()).toBe(true);
    });

    it('a long break cut short by sleep counts as completed when at least half elapsed (watchdog)', () => {
      const t = harness();
      const spec = { label: 'reminder:2', animation: 'meal' as const, seconds: 600, title: 'Lunch', text: '' };
      t.overlay.start(spec);
      vi.advanceTimersByTime(600_000 + 15_000 + 1);
      expect(t.done.at(-1)).toMatchObject({ spec, completed: true });
    });

    it('a short break ended by the watchdog is not completed', () => {
      const t = harness();
      t.overlay.start(PRESETS.eye);
      vi.advanceTimersByTime(20_000 + 15_000 + 1);
      expect(t.done.at(-1)).toMatchObject({ completed: false });
    });
  });

  describe('start() failure handling', () => {
    it('returns false and closes windows already made if makeWindow throws partway through', () => {
      const wins: FakeWin[] = [];
      let call = 0;
      const o = createBreakOverlay({
        displays: () => [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, primary: true }, { bounds: { x: 1, y: 0, width: 1, height: 1 }, primary: false }],
        makeWindow: () => {
          call++;
          if (call === 2) throw new Error('no window for you');
          const w = new FakeWin(); wins.push(w); return w;
        },
        onDone: () => {}
      });
      vi.useFakeTimers();
      expect(o.start(PRESETS.eye)).toBe(false);
      expect(wins).toHaveLength(1);
      expect(wins[0].closed).toBe(true);
      expect(o.active()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      // A later start() must work normally.
      expect(o.start(PRESETS.eye)).toBe(true);
      vi.useRealTimers();
    });

    it('returns false without starting when there are no displays', () => {
      const o = createBreakOverlay({ displays: () => [], makeWindow: () => new FakeWin(), onDone: () => {} });
      expect(o.start(PRESETS.eye)).toBe(false);
      expect(o.active()).toBe(false);
    });
  });
});
