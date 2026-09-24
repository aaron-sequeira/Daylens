import { createInterface } from 'node:readline';

export type OcrStatus = 'off' | 'starting' | 'ready' | 'no-language' | 'restarting' | 'failed';
export interface CaptureResult { text: string; ms: number; pid: number; title: string; w: number; h: number; }
export interface ChildLike {
  stdin: {
    write(s: string): unknown;
    end(): unknown;
    on(ev: 'error', cb: (err: Error) => void): unknown;
  };
  stdout: NodeJS.ReadableStream;
  on(ev: 'exit', cb: (code: number | null) => void): unknown;
  on(ev: 'error', cb: (err: Error) => void): unknown;
  kill(): unknown;
}
export interface OcrClient { start(): void; stop(): void; capture(): Promise<CaptureResult | null>; status(): OcrStatus; }

export const RESTART_DELAYS_MS = [1000, 5000, 30000] as const;
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 3; // more than this within the window → failed
const NO_LANGUAGE_EXIT_CODE = 2;

type Reply = { id?: string; ready?: boolean; error?: string; text?: string; ms?: number; pid?: number; title?: string; w?: number; h?: number };

export function createOcrClient(deps: { spawn: () => ChildLike; onStatus?: (s: OcrStatus) => void; timeoutMs?: number }): OcrClient {
  const timeoutMs = deps.timeoutMs ?? 8000;
  let status: OcrStatus = 'off';
  let child: ChildLike | null = null;
  let seq = 0;
  let pending: { id: string; resolve: (r: CaptureResult | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let crashes: number[] = [];

  const setStatus = (s: OcrStatus): void => { if (s !== status) { status = s; deps.onStatus?.(s); } };
  const settle = (r: CaptureResult | null): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { resolve } = pending;
    pending = null;
    resolve(r);
  };

  function onLine(line: string): void {
    let msg: Reply;
    try { msg = JSON.parse(line) as Reply; } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.ready === true) { setStatus('ready'); return; }
    if (msg.ready === false) { setStatus('no-language'); return; }
    if (!pending || msg.id !== pending.id) return;
    if (msg.error || typeof msg.text !== 'string') { settle(null); return; }
    settle({ text: msg.text, ms: msg.ms ?? 0, pid: msg.pid ?? -1, title: msg.title ?? '', w: msg.w ?? 0, h: msg.h ?? 0 });
  }

  function scheduleRestart(): void {
    const now = Date.now();
    crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (crashes.length > MAX_CRASHES) { setStatus('failed'); return; }
    setStatus('restarting');
    restartTimer = setTimeout(spawnChild, RESTART_DELAYS_MS[Math.min(crashes.length, RESTART_DELAYS_MS.length) - 1]);
  }

  function spawnChild(): void {
    restartTimer = null;
    setStatus('starting');
    let c: ChildLike;
    try {
      c = deps.spawn();
    } catch {
      // spawn() threw synchronously (e.g. ENOENT raised eagerly) — treat like a crash.
      scheduleRestart();
      return;
    }
    child = c;
    let handled = false; // an 'error' and a subsequent 'exit' for the same child must count once
    const down = (code: number | null): void => {
      if (handled) return;
      handled = true;
      if (child !== c) return; // this child was already stopped/replaced
      child = null;
      settle(null);
      if (code === NO_LANGUAGE_EXIT_CODE) { setStatus('no-language'); return; }
      scheduleRestart();
    };
    createInterface({ input: c.stdout }).on('line', (l) => {
      if (child === c) onLine(l); // drop lines that arrive after this child was stopped/replaced
    });
    c.stdin.on('error', () => {}); // dead pipe (e.g. write after a timeout kill); the exit/timeout path recovers
    c.on('exit', (code) => down(code));
    c.on('error', () => down(null));
  }

  return {
    start() {
      if (status !== 'off') return;
      crashes = [];
      spawnChild();
    },
    stop() {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      setStatus('off');
      settle(null);
      const c = child;
      child = null;
      if (c) { c.stdin.end(); c.kill(); }
    },
    capture() {
      if (status !== 'ready' || !child || pending) return Promise.resolve(null);
      const id = String(++seq);
      const c = child;
      return new Promise((resolve) => {
        const timer = setTimeout(() => { settle(null); c.kill(); }, timeoutMs);
        pending = { id, resolve, timer };
        c.stdin.write(`${id} CAPTURE\n`);
      });
    },
    status: () => status
  };
}
