import { createHash, type Hash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
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

type MarkerEntries = Record<string, { size: number; mtimeMs: number }>;

const sizeOf = async (p: string): Promise<number> => (await fsp.stat(p).catch(() => null))?.size ?? 0;
function isMarkerEntries(v: unknown): v is MarkerEntries {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
async function feed(hash: Hash, path: string, signal?: AbortSignal): Promise<void> {
  for await (const chunk of createReadStream(path)) {
    if (signal?.aborted) return;
    hash.update(chunk as Buffer);
  }
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
  const set = (s: ModelStatus): void => {
    status = s;
    try { deps.onStatus?.(s); } catch { /* a throwing callback must not surface as a download failure */ }
  };
  const final = (f: ModelFile): string => join(dir, f.name);
  const part = (f: ModelFile): string => join(dir, `${f.name}.part`);

  async function readMarker(): Promise<MarkerEntries> {
    const raw = await fsp.readFile(join(dir, MARKER), 'utf8').catch(() => null);
    if (raw == null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return isMarkerEntries(parsed) ? parsed : {};
    } catch {
      return {}; // a corrupt/torn marker just means "verify from scratch", not a crash
    }
  }

  async function writeMarker(): Promise<void> {
    const entries: MarkerEntries = {};
    for (const f of manifest.files) { const st = await fsp.stat(final(f)); entries[f.name] = { size: st.size, mtimeMs: st.mtimeMs }; }
    const tmp = join(dir, `${MARKER}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(entries));
    await fsp.rename(tmp, join(dir, MARKER));
  }

  /** Sum of bytes already durably on disk for the manifest (finished files count in full). Used to tell whether a failed attempt made progress. */
  async function bytesOnDisk(): Promise<number> {
    let sum = 0;
    for (const f of manifest.files) {
      const finalSize = await sizeOf(final(f));
      sum += finalSize === f.size ? f.size : Math.min(await sizeOf(part(f)), f.size);
    }
    return sum;
  }

  /** Download one file into place; false = hash mismatch (the partial file is deleted). */
  async function downloadFile(f: ModelFile, done: number, signal: AbortSignal): Promise<boolean> {
    let have = await sizeOf(part(f));
    if (have > f.size) { await fsp.rm(part(f), { recursive: true, force: true }); have = 0; }
    let hash = createHash('sha256');
    if (have > 0) await feed(hash, part(f), signal);
    if (have < f.size) {
      const res = await deps.fetch(`${manifest.baseUrl}/${f.name}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal });
      if (res.status === 200 && have > 0) { have = 0; hash = createHash('sha256'); } // server ignored Range: start over
      else if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
      const fh = await fsp.open(part(f), have ? 'a' : 'w');
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          const b = Buffer.from(chunk);
          have += b.length;
          if (have > f.size) throw new Error(`overlong download ${f.name}: ${have}/${f.size}`);
          hash.update(b);
          await fh.write(b);
          const t = Date.now();
          if (!signal.aborted && t - lastProgress >= PROGRESS_MS) { lastProgress = t; set({ state: 'downloading', received: done + have, total, retrying: false }); }
        }
      } finally {
        await fh.close();
      }
    }
    const onDisk = await sizeOf(part(f));
    if (onDisk !== f.size) throw new Error(`short download ${f.name}: ${onDisk}/${f.size}`);
    set({ state: 'verifying' });
    if (hash.digest('hex') !== f.sha256) { await fsp.rm(part(f), { recursive: true, force: true }); return false; }
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
    let before = await bytesOnDisk();
    while (!signal.aborted) {
      try { await downloadAll(signal); return; } catch (e) {
        if (signal.aborted) return;
        if (e instanceof Fatal) { set({ state: 'error', reason: e.reason }); return; }
        const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
        const after = await bytesOnDisk();
        failures = after > before ? 0 : failures + 1; // a flaky link that keeps making progress shouldn't escalate to the long backoffs
        before = after;
        set({ state: 'downloading', received: after, total, retrying: true });
        await wait(delay, signal);
      }
    }
  }

  function startImpl(): void {
    if (controller || status.state === 'ready') return;
    const c = new AbortController();
    controller = c;
    set({ state: 'downloading', received: 0, total, retrying: false });
    const prev = run;
    // Chain onto the previous run so a start() shortly after a stop() can't launch a second loop
    // while the old one is still unwinding (which could append to the same .part concurrently).
    run = prev.catch(() => {}).then(() => loop(c.signal)).finally(() => { if (controller === c) controller = null; });
  }

  function stopImpl(): void {
    if (!controller) return;
    controller.abort();
    controller = null;
    if (status.state !== 'ready' && status.state !== 'error') set({ state: 'missing' });
  }

  return {
    async init() {
      await fsp.mkdir(dir, { recursive: true });
      const marker = await readMarker();
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
    start: startImpl,
    stop: stopImpl,
    async remove() {
      stopImpl();
      await run;
      // Only the manifest's own files: `dir` may be a shared/dev folder with unrelated content.
      for (const f of manifest.files) {
        await fsp.rm(final(f), { force: true });
        await fsp.rm(part(f), { recursive: true, force: true });
      }
      await fsp.rm(join(dir, MARKER), { force: true });
      await fsp.rm(join(dir, `${MARKER}.tmp`), { force: true });
      set({ state: 'missing' });
    },
    status: () => status,
    done: () => run
  };
}
