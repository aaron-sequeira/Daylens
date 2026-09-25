import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fsp, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';

export interface ModelFile { name: string; size: number; sha256: string; }
export interface Manifest { baseUrl: string; files: ModelFile[]; }
export type ModelStatus =
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number; retrying: boolean }
  | { state: 'verifying' }
  | { state: 'ready' }
  | { state: 'error'; reason: 'no_space' | 'bad_hash' };
export interface Downloader { init(): Promise<ModelStatus>; start(): void; stop(): void; remove(): Promise<void>; status(): ModelStatus; done(): Promise<void>; }

export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
const SPACE_MARGIN = 500 * 1024 * 1024;
const MARKER = '.verified.json';
const PROGRESS_MS = 250;

class Fatal extends Error { constructor(readonly reason: 'no_space' | 'bad_hash') { super(reason); } }

const sizeOf = async (p: string): Promise<number> => (await fsp.stat(p).catch(() => null))?.size ?? 0;
async function feed(hash: Hash, path: string): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}
async function hashFile(path: string): Promise<string> { const h = createHash('sha256'); await feed(h, path); return h.digest('hex'); }
const defaultWait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createDownloader(deps: {
  dir: string; manifest: Manifest; fetch: typeof fetch; freeBytes(dir: string): Promise<number>;
  wait?(ms: number, signal: AbortSignal): Promise<void>; onStatus?(s: ModelStatus): void;
}): Downloader {
  const { dir, manifest } = deps;
  const wait = deps.wait ?? defaultWait;
  const total = manifest.files.reduce((a, f) => a + f.size, 0);
  let status: ModelStatus = { state: 'missing' };
  let controller: AbortController | null = null;
  let run: Promise<void> = Promise.resolve();
  let lastProgress = 0;
  const set = (s: ModelStatus): void => { status = s; deps.onStatus?.(s); };
  const final = (f: ModelFile): string => join(dir, f.name);
  const part = (f: ModelFile): string => join(dir, `${f.name}.part`);

  async function writeMarker(): Promise<void> {
    const entries: Record<string, { size: number; mtimeMs: number }> = {};
    for (const f of manifest.files) { const st = await fsp.stat(final(f)); entries[f.name] = { size: st.size, mtimeMs: st.mtimeMs }; }
    await fsp.writeFile(join(dir, MARKER), JSON.stringify(entries));
  }

  /** Download one file into place; false = hash mismatch (the partial file is deleted). */
  async function downloadFile(f: ModelFile, done: number, signal: AbortSignal): Promise<boolean> {
    let have = await sizeOf(part(f));
    if (have > f.size) { await fsp.rm(part(f)); have = 0; }
    let hash = createHash('sha256');
    if (have > 0) await feed(hash, part(f));
    if (have < f.size) {
      const res = await deps.fetch(`${manifest.baseUrl}/${f.name}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal });
      if (res.status === 200 && have > 0) { have = 0; hash = createHash('sha256'); } // server ignored Range: start over
      else if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
      const out: WriteStream = createWriteStream(part(f), { flags: have ? 'a' : 'w' });
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          const b = Buffer.from(chunk);
          hash.update(b);
          if (!out.write(b)) await once(out, 'drain');
          have += b.length;
          const t = Date.now();
          if (t - lastProgress >= PROGRESS_MS) { lastProgress = t; set({ state: 'downloading', received: done + have, total, retrying: false }); }
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
    }
    if (have !== f.size) throw new Error(`short download ${f.name}: ${have}/${f.size}`);
    set({ state: 'verifying' });
    if (hash.digest('hex') !== f.sha256) { await fsp.rm(part(f), { force: true }); return false; }
    await fsp.rename(part(f), final(f));
    return true;
  }

  async function downloadAll(signal: AbortSignal): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
    let remaining = 0;
    for (const f of manifest.files) if ((await sizeOf(final(f))) !== f.size) remaining += f.size - Math.min(await sizeOf(part(f)), f.size);
    if ((await deps.freeBytes(dir)) < remaining + SPACE_MARGIN) throw new Fatal('no_space');
    let done = 0;
    for (const f of manifest.files) {
      if ((await sizeOf(final(f))) === f.size) { done += f.size; continue; } // renamed into place only after a hash check
      if (!(await downloadFile(f, done, signal)) && !(await downloadFile(f, done, signal))) throw new Fatal('bad_hash');
      done += f.size;
    }
    await writeMarker();
    set({ state: 'ready' });
  }

  async function loop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try { await downloadAll(signal); return; } catch (e) {
        if (signal.aborted) return;
        if (e instanceof Fatal) { set({ state: 'error', reason: e.reason }); return; }
        const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
        failures++;
        const received = status.state === 'downloading' ? status.received : 0;
        set({ state: 'downloading', received, total, retrying: true });
        await wait(delay, signal);
      }
    }
  }

  return {
    async init() {
      await fsp.mkdir(dir, { recursive: true });
      const marker = JSON.parse(await fsp.readFile(join(dir, MARKER), 'utf8').catch(() => '{}')) as Record<string, { size: number; mtimeMs: number }>;
      for (const f of manifest.files) {
        const st = await fsp.stat(final(f)).catch(() => null);
        if (!st || st.size !== f.size) { set({ state: 'missing' }); return status; }
        const m = marker[f.name];
        if (m && m.size === st.size && m.mtimeMs === st.mtimeMs) continue;
        if ((await hashFile(final(f))) !== f.sha256) { await fsp.rm(final(f), { force: true }); set({ state: 'missing' }); return status; }
      }
      await writeMarker();
      set({ state: 'ready' });
      return status;
    },
    start() {
      if (controller || status.state === 'ready') return;
      const c = new AbortController();
      controller = c;
      set({ state: 'downloading', received: 0, total, retrying: false });
      run = loop(c.signal).finally(() => { if (controller === c) controller = null; });
    },
    stop() {
      if (!controller) return;
      controller.abort();
      controller = null;
      if (status.state !== 'ready' && status.state !== 'error') set({ state: 'missing' });
    },
    async remove() {
      this.stop();
      await run;
      await fsp.rm(dir, { recursive: true, force: true });
      set({ state: 'missing' });
    },
    status: () => status,
    done: () => run
  };
}
