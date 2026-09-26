import { writerResponse, type WriterRequest } from './protocol';

export interface WriterChild { post(m: WriterRequest): void; onMessage(cb: (m: unknown) => void): void; onExit(cb: (code: number | null) => void): void; kill(): void; }
export type LocalResult = { ok: true; json: unknown } | { ok: false; reason: 'timeout' | 'crash' | 'load' | 'error'; message: string };
const EXIT_GRACE_MS = 1_000; // a clean exit may overtake the last message

/** One job = one process: start it, wait for one answer (or a crash / the deadline), always kill it. */
export function runLocal(req: WriterRequest, deps: { fork(): WriterChild; timeoutMs: number }): Promise<LocalResult> {
  return new Promise((resolve) => {
    let child: WriterChild;
    try { child = deps.fork(); } catch (e) { resolve({ ok: false, reason: 'crash', message: String(e) }); return; }
    let settled = false;
    const finish = (r: LocalResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', message: `no answer in ${deps.timeoutMs} ms` }), deps.timeoutMs);
    child.onMessage((m) => {
      const r = writerResponse.safeParse(m);
      if (!r.success) { finish({ ok: false, reason: 'error', message: 'malformed message' }); return; }
      if (r.data.op === 'written') finish({ ok: true, json: r.data.json });
      else finish({ ok: false, reason: r.data.message.startsWith('load:') ? 'load' : 'error', message: r.data.message });
    });
    child.onExit((code) => {
      if (code === 0) setTimeout(() => finish({ ok: false, reason: 'crash', message: 'exited without an answer' }), EXIT_GRACE_MS);
      else finish({ ok: false, reason: 'crash', message: `exit ${code}` });
    });
    try { child.post(req); } catch (e) { finish({ ok: false, reason: 'crash', message: String(e) }); }
  });
}
