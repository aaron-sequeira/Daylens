import { describe, it, expect, vi, afterEach } from 'vitest';
import { runLocal, type WriterChild } from './run';

const req = { op: 'write' as const, modelPath: 'm.gguf', gpu: 'auto' as const, schema: {}, system: 's', user: 'u', maxTokens: 100, contextSize: 8192 };
function fake() {
  let msg: (m: unknown) => void = () => {}; let exit: (c: number | null) => void = () => {};
  const child: WriterChild & { killed: boolean; sent: unknown[] } = {
    killed: false, sent: [], post(m) { this.sent.push(m); }, onMessage(cb) { msg = cb; }, onExit(cb) { exit = cb; }, kill() { this.killed = true; }
  };
  return { child, msg: (m: unknown) => msg(m), exit: (c: number | null) => exit(c) };
}
afterEach(() => vi.useRealTimers());

describe('runLocal', () => {
  it('resolves with the written json and kills the child', async () => {
    const f = fake();
    const p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'written', json: { a: 1 } });
    expect(await p).toEqual({ ok: true, json: { a: 1 } });
    expect(f.child.killed).toBe(true);
    expect(f.child.sent).toEqual([req]);
  });
  it('maps load errors, other errors, crashes and timeouts', async () => {
    let f = fake(); let p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'error', message: 'load: bad file' });
    expect(await p).toMatchObject({ ok: false, reason: 'load' });
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'error', message: 'boom' });
    expect(await p).toMatchObject({ ok: false, reason: 'error' });
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.exit(3221225477);
    expect(await p).toMatchObject({ ok: false, reason: 'crash' });
    vi.useFakeTimers();
    f = fake(); p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
    expect(f.child.killed).toBe(true);
  });
  it('rejects malformed messages as errors and treats a throwing fork as a crash', async () => {
    const f = fake(); const p = runLocal(req, { fork: () => f.child, timeoutMs: 1000 });
    f.msg({ op: 'nope' });
    expect(await p).toMatchObject({ ok: false, reason: 'error' });
    expect(await runLocal(req, { fork: () => { throw new Error('x'); }, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: 'crash' });
  });
});
