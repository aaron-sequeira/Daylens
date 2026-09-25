import { describe, it, expect } from 'vitest';
import { createPillManager, pillMessage, type PillWindowLike } from './pill';
import type { PillNudge } from '../coach/types';

class FakeWin implements PillWindowLike {
  sent: [string, unknown][] = []; ignore = true; shown = 0; destroyed = false; pos: [number, number] = [0, 0];
  private ready: (() => void) | null = null;
  send(c: string, p?: unknown) { this.sent.push([c, p]); }
  setIgnoreMouseEvents(i: boolean) { this.ignore = i; }
  showInactive() { this.shown++; }
  setPosition(x: number, y: number) { this.pos = [x, y]; }
  destroy() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
  onReady(cb: () => void) { this.ready = cb; }
  fireReady() { this.ready?.(); }
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
  it('dismissAll before the page is ready clears the queue and reports dismiss for each queued nudge', () => {
    const acts: [number, string][] = [];
    const w = new FakeWin();
    const m = createPillManager({ makeWindow: () => w, placement: () => ({ x: 0, y: 0 }), onAction: (id, a) => acts.push([id, a]) });
    m.show(n(1));
    m.show(n(2));
    expect(w.sent).toEqual([]); // not ready yet: both nudges are only queued
    m.dismissAll();
    expect(acts).toEqual([[1, 'dismiss'], [2, 'dismiss']]);
    w.fireReady();
    expect(w.sent).toEqual([['pill:dismissAll', undefined]]); // queue was cleared, nothing to flush
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
});
