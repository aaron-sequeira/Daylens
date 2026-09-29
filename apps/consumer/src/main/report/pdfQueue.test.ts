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

  it('never runs two jobs at once: a schedule() made while one is in flight waits for it to finish', async () => {
    const order: string[] = [];
    const first = deferred();
    const run = vi.fn((d: string) => { order.push(`start:${d}`); return d === 'a' ? first.promise : Promise.resolve(); });
    const q = createPdfQueue(run);
    q.schedule('a');
    q.schedule('b'); // 'a' hasn't resolved yet: must not start 'b' now
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve();
    await tick(); await tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['start:a', 'start:b']);
  });

  it('coalesces a burst of schedule() calls into a single queued run of the latest date', async () => {
    const order: string[] = [];
    const first = deferred();
    const run = vi.fn((d: string) => { order.push(`start:${d}`); return d === 'x' ? first.promise : Promise.resolve(); });
    const q = createPdfQueue(run);
    q.schedule('x'); // runs immediately
    q.schedule('y'); // queued
    q.schedule('y'); // same date again: still just one queued slot
    q.schedule('z'); // replaces the queued 'y' with 'z' rather than adding a second queued job
    first.resolve();
    await tick(); await tick();
    expect(order).toEqual(['start:x', 'start:z']); // 'y' never ran on its own
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps running later dates after an earlier run rejects', async () => {
    const order: string[] = [];
    const run = vi.fn((d: string) => { order.push(d); return d === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(); });
    const q = createPdfQueue(run);
    q.schedule('a');
    q.schedule('b');
    await tick(); await tick(); await tick();
    expect(order).toEqual(['a', 'b']);
  });
});
