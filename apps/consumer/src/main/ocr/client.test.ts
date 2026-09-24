import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createOcrClient, type ChildLike, type OcrStatus } from './client';

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough();
  written: string[] = [];
  killed = false;
  stdin = { write: (s: string) => { this.written.push(s); return true; }, end: () => undefined };
  kill() { this.killed = true; this.emit('exit', null); return true; }
  say(obj: unknown) { this.stdout.write(JSON.stringify(obj) + '\n'); }
}

const flush = () => new Promise<void>((r) => setImmediate(r));
let children: FakeChild[];
let statuses: OcrStatus[];
const make = () => createOcrClient({
  spawn: () => { const c = new FakeChild(); children.push(c); return c; },
  onStatus: (s) => statuses.push(s)
});

beforeEach(() => { children = []; statuses = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('ocr client', () => {
  it('starts, becomes ready, and captures', async () => {
    const c = make();
    expect(c.status()).toBe('off');
    c.start();
    expect(c.status()).toBe('starting');
    children[0].say({ ready: true });
    await flush();
    expect(c.status()).toBe('ready');
    const p = c.capture();
    expect(children[0].written).toEqual(['1 CAPTURE\n']);
    children[0].say({ id: '1', text: 'hello', ms: 50, pid: 42, title: 'T', w: 800, h: 600 });
    await flush();
    await expect(p).resolves.toEqual({ text: 'hello', ms: 50, pid: 42, title: 'T', w: 800, h: 600 });
  });

  it('returns null when not ready, for no_window, and while a request is in flight', async () => {
    const c = make();
    await expect(c.capture()).resolves.toBeNull();
    c.start(); children[0].say({ ready: true }); await flush();
    const p1 = c.capture();
    await expect(c.capture()).resolves.toBeNull();
    children[0].say({ id: '1', error: 'no_window' }); await flush();
    await expect(p1).resolves.toBeNull();
  });

  it('reports no-language and does not restart', async () => {
    const c = make();
    c.start();
    children[0].say({ ready: false, error: 'no_ocr_language' }); await flush();
    children[0].emit('exit', 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.status()).toBe('no-language');
    expect(children).toHaveLength(1);
  });

  it('times out a hung capture, kills the helper and restarts after 1 s', async () => {
    const c = make();
    c.start(); children[0].say({ ready: true }); await flush();
    const p = c.capture();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBeNull();
    expect(children[0].killed).toBe(true);
    expect(c.status()).toBe('restarting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(2);
    expect(c.status()).toBe('starting');
  });

  it('backs off 1 s, 5 s, 30 s and fails after more than 3 crashes in 10 minutes', async () => {
    const c = make();
    c.start();
    children[0].emit('exit', 1); await vi.advanceTimersByTimeAsync(1000); expect(children).toHaveLength(2);
    children[1].emit('exit', 1); await vi.advanceTimersByTimeAsync(4999); expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(children).toHaveLength(3);
    children[2].emit('exit', 1); await vi.advanceTimersByTimeAsync(30_000); expect(children).toHaveLength(4);
    children[3].emit('exit', 1); await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(4);
    expect(c.status()).toBe('failed');
  });

  it('stop() ends the helper without restarting, and stop/start clears a failure', async () => {
    const c = make();
    c.start(); children[0].say({ ready: true }); await flush();
    c.stop();
    expect(children[0].killed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    expect(c.status()).toBe('off');
    c.start();
    expect(children).toHaveLength(2);
    expect(statuses).toContain('off');
  });

  it('start() is idempotent while running', () => {
    const c = make();
    c.start(); c.start();
    expect(children).toHaveLength(1);
  });
});
