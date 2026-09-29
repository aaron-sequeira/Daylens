import { describe, it, expect, vi } from 'vitest';
import { createPdfQueue } from './pdfQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createPdfQueue', () => {
  it('starts a run immediately when idle', () => {
    const run = vi.fn(() => Promise.resolve());
    createPdfQueue(run).schedule('2026-09-26');
    expect(run).toHaveBeenCalledWith('2026-09-26');
  });

  it('with A running, B and C scheduled both run afterwards, in order (no date is dropped)', async () => {
    const order: string[] = [];
    const gateA = deferred();
    const gateB = deferred();
    const run = vi.fn((d: string) => {
      order.push(d);
      if (d === 'a') return gateA.promise;
      if (d === 'b') return gateB.promise;
      return Promise.resolve();
    });
    const q = createPdfQueue(run);
    q.schedule('a'); // starts immediately
    q.schedule('b'); // queued behind 'a'
    q.schedule('c'); // queued behind 'b'
    expect(order).toEqual(['a']); // 'b' and 'c' must not start while 'a' is still running
    gateA.resolve();
    await tick(); await tick();
    expect(order).toEqual(['a', 'b']);
    gateB.resolve();
    await tick(); await tick();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('with A running, scheduling A twice more queues it only once: it runs once more, not twice', async () => {
    const order: string[] = [];
    const first = deferred();
    const run = vi.fn((d: string) => { order.push(d); return order.length === 1 ? first.promise : Promise.resolve(); });
    const q = createPdfQueue(run);
    q.schedule('a'); // running (call 1)
    q.schedule('a'); // queues one more run of 'a'
    q.schedule('a'); // 'a' is already queued: must not add a second one
    first.resolve();
    await tick(); await tick();
    expect(order).toEqual(['a', 'a']); // exactly one extra run, not two
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps running the rest of the queue after an earlier run rejects', async () => {
    const order: string[] = [];
    const run = vi.fn((d: string) => { order.push(d); return d === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(); });
    const q = createPdfQueue(run);
    q.schedule('a');
    q.schedule('b');
    q.schedule('c');
    await tick(); await tick(); await tick();
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
