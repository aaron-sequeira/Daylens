import { describe, it, expect } from 'vitest';
import { createPillManager, pillMessage, type PillWindowLike } from './pill';
import type { PillNudge } from '../coach/types';

class FakeWin implements PillWindowLike {
  // Starts false (not the "already passthrough" true) so a test asserting
  // `ignore === true` actually proves setIgnoreMouseEvents(true) was called,
  // rather than passing vacuously off the initial value.
  sent: [string, unknown][] = []; ignore = false; shown = 0; destroyed = false; pos: [number, number] = [0, 0];
  private ready: (() => void) | null = null;
  private closed: (() => void) | null = null;
  send(c: string, p?: unknown) { this.sent.push([c, p]); }
  setIgnoreMouseEvents(i: boolean) { this.ignore = i; }
  showInactive() { this.shown++; }
  setPosition(x: number, y: number) { this.pos = [x, y]; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.closed?.(); } }
  isDestroyed() { return this.destroyed; }
  onReady(cb: () => void) { this.ready = cb; }
  onClosed(cb: () => void) { this.closed = cb; }
  fireReady() { this.ready?.(); }
  /** did-fail-load / render-process-gone: the adapter destroys the window, which emits 'closed'. */
  crash() { this.destroy(); }
}
const n = (id: number): PillNudge => ({ id, kind: 'health', mini: 'm', stat: 's', title: 't', body: 'b', primaryLabel: 'OK', offerFewer: false });

describe('pill manager', () => {
  it('creates the window on demand, queues until ready, shows inactive at the placement', () => {
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 1504, y: 16 }), onAction: () => {} });
    expect(m.show(n(1))).toBe(true);
    expect(wins).toHaveLength(1);
    expect(wins[0].sent).toEqual([]);
    wins[0].fireReady();
    expect(wins[0].sent).toEqual([['pill:show', n(1)]]);
    expect(wins[0].shown).toBe(1);
    expect(wins[0].pos).toEqual([1504, 16]);
    m.show(n(2));
    expect(wins).toHaveLength(1);
    expect(wins[0].sent.at(-1)).toEqual(['pill:show', n(2)]);
  });
  it('toggles mouse passthrough on hover, forwards actions, destroys when empty', () => {
    const acts: [number, string][] = [];
    const w = new FakeWin();
    const m = createPillManager({ makeWindow: () => w, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1)); w.fireReady();
    m.handle({ type: 'hover', hover: true }); expect(w.ignore).toBe(false);
    m.handle({ type: 'hover', hover: false }); expect(w.ignore).toBe(true);
    m.handle({ type: 'action', id: 1, action: 'dismiss' }); expect(acts).toEqual([[1, 'dismiss']]);
    m.handle({ type: 'empty' }); expect(w.destroyed).toBe(true);
  });
  it('returns false if the window cannot be created', () => {
    const m = createPillManager({ makeWindow: () => { throw new Error('no'); }, placement: () => ({ x: 0, y: 0 }), onAction: () => {} });
    expect(m.show(n(1))).toBe(false);
  });
  it('validates renderer messages', () => {
    expect(pillMessage.safeParse({ type: 'action', id: 3, action: 'primary' }).success).toBe(true);
    expect(pillMessage.safeParse({ type: 'action', id: 3, action: 'hack' }).success).toBe(false);
  });
  it('dismissAll before the page is ready clears the queue and reports each queued nudge expired (bulk dismiss is not a dismissal)', () => {
    const acts: [number, string][] = [];
    const w = new FakeWin();
    const m = createPillManager({ makeWindow: () => w, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1));
    m.show(n(2));
    expect(w.sent).toEqual([]); // not ready yet: both nudges are only queued
    m.dismissAll();
    expect(acts).toEqual([[1, 'expired'], [2, 'expired']]);
    w.fireReady();
    expect(w.sent).toEqual([['pill:dismissAll', undefined]]); // queue was cleared, nothing to flush
    expect(w.shown).toBe(0); // no showInactive() for a window with nothing to show
  });
  it('recreates the window after empty, with fresh mouse passthrough', () => {
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 0, y: 0 }), onAction: () => {} });
    m.show(n(1));
    wins[0].fireReady();
    m.handle({ type: 'action', id: 1, action: 'dismiss' });
    m.handle({ type: 'empty' });
    expect(wins[0].destroyed).toBe(true);
    m.show(n(2));
    expect(wins).toHaveLength(2);
    expect(wins[1].ignore).toBe(true);
  });
  it('ignores empty while a shown nudge is still outstanding (main/renderer race)', () => {
    const w = new FakeWin();
    const m = createPillManager({ makeWindow: () => w, placement: () => ({ x: 0, y: 0 }), onAction: () => {} });
    m.show(n(1));
    w.fireReady();
    m.handle({ type: 'empty' }); // renderer's own drain-to-zero crossed in flight with our 'pill:show'
    expect(w.destroyed).toBe(false);
    m.handle({ type: 'action', id: 1, action: 'dismiss' });
    m.handle({ type: 'empty' });
    expect(w.destroyed).toBe(true);
  });
  it('reports outstanding ids as expired when the window is replaced after a crash, so the replacement is not stranded', () => {
    const acts: [number, string][] = [];
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1));
    wins[0].fireReady(); // outstanding = {1}
    wins[0].destroyed = true; // simulate a crash: did-fail-load / render-process-gone in the real adapter
    m.show(n(2)); // manager notices the dead window and replaces it
    expect(acts).toEqual([[1, 'expired']]); // stale id1 reported, not silently dropped
    expect(wins).toHaveLength(2);
    wins[1].fireReady();
    m.handle({ type: 'action', id: 2, action: 'dismiss' });
    m.handle({ type: 'empty' });
    expect(wins[1].destroyed).toBe(true); // replacement window isn't stranded by the stale id
  });
  it('reports still-queued nudges expired and drops them when a window that never loaded is replaced', () => {
    const acts: [number, string][] = [];
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1)); // queued: page not ready
    wins[0].crash(); // did-fail-load before ready
    m.show(n(2));
    expect(acts).toEqual([[1, 'expired']]);
    wins[1].fireReady();
    expect(wins[1].sent).toEqual([['pill:show', n(2)]]); // no stale nudge 1
  });
  it('reports visibility: true when it first shows a window, false when that window is destroyed (empty or crash)', () => {
    const vis: boolean[] = [];
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 0, y: 0 }), onAction: () => {}, onVisible: (v) => vis.push(v) });
    m.show(n(1));
    expect(vis).toEqual([]); // created but nothing shown yet
    wins[0].fireReady();
    m.show(n(2));
    expect(vis).toEqual([true]); // once per window, not per flush
    m.handle({ type: 'action', id: 1, action: 'dismiss' });
    m.handle({ type: 'action', id: 2, action: 'dismiss' });
    m.handle({ type: 'empty' });
    expect(vis).toEqual([true, false]);
    m.show(n(3)); wins[1].fireReady();
    expect(vis).toEqual([true, false, true]);
    wins[1].crash();
    expect(vis).toEqual([true, false, true, false]);
    m.show(n(4)); wins[2].fireReady();
    expect(vis).toEqual([true, false, true, false, true]);
  });
  it('does not report visibility for a window that never showed anything', () => {
    const vis: boolean[] = [];
    const wins: FakeWin[] = [];
    const m = createPillManager({ makeWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, placement: () => ({ x: 0, y: 0 }), onAction: () => {}, onVisible: (v) => vis.push(v) });
    m.show(n(1));
    wins[0].crash();
    expect(vis).toEqual([]);
  });
});
