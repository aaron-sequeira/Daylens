import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDownloader, type Manifest } from './downloader';

// Shared, hoisted mutable state the 'node:fs' mock below reads -- vi.mock factories are hoisted above
// imports, so any state they close over must come from vi.hoisted(). Both hooks are no-ops (pass straight
// through to the real implementation) unless a specific test arms them, so every other test is unaffected.
const fsHooks = vi.hoisted(() => ({
  onSecondReadChunk: null as (() => void) | null, // fires just before the 2nd chunk of a createReadStream read is handed to the consumer
  failNextRm: false // makes the next fsp.rm() call reject once, then resets itself
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args);
      if (fsHooks.onSecondReadChunk) {
        const fire = fsHooks.onSecondReadChunk;
        fsHooks.onSecondReadChunk = null;
        const boundIterator = (stream[Symbol.asyncIterator] as () => AsyncIterator<unknown>).bind(stream);
        let calls = 0;
        (stream as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = () => {
          const iter = boundIterator();
          return {
            next: async () => {
              calls++;
              const result = await iter.next();
              if (calls === 2) {
                fire(); // triggers d.stop() (aborts the download's own signal)
                // Proactively close the fd here rather than relying on the for-await loop's implicit
                // AsyncIteratorClose cleanup timing, so the test's afterEach never races an open handle.
                await new Promise<void>((resolve) => {
                  if (stream.destroyed) return resolve();
                  stream.once('close', () => resolve());
                  stream.destroy();
                });
              }
              return result;
            },
            return: (value?: unknown) => (iter.return ? iter.return(value) : Promise.resolve({ value, done: true })),
            throw: (err?: unknown) => (iter.throw ? iter.throw(err) : Promise.reject(err))
          };
        };
      }
      return stream;
    },
    promises: {
      ...actual.promises,
      rm: async (...args: Parameters<typeof actual.promises.rm>) => {
        if (fsHooks.failNextRm) { fsHooks.failNextRm = false; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); }
        return actual.promises.rm(...args);
      }
    }
  };
});

const A = randomBytes(200_000), B = randomBytes(1_000);
const OVERLONG = randomBytes(200_050); // deliberately longer than a.bin's declared 200_000-byte size, and unrelated content
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
type Opts = { ignoreRange?: boolean; fail?: number; cutFirstAt?: number; holdAfter?: number; overlong?: boolean };
let server: Server; let base: string; let dir: string; let reqs: { path: string; range?: string }[]; let opts: Opts;
const files: Record<string, Buffer> = { 'a.bin': A, 'b.json': B };

beforeEach(async () => {
  reqs = []; opts = {}; dir = mkdtempSync(join(tmpdir(), 'dl-'));
  fsHooks.onSecondReadChunk = null; fsHooks.failNextRm = false;
  let cut = false; let held = false;
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    reqs.push({ path: name, range: req.headers.range });
    if (opts.fail && opts.fail > 0) { opts.fail--; res.writeHead(500).end(); return; }
    if (opts.overlong && name === 'a.bin') {
      const m0 = /bytes=(\d+)-/.exec(req.headers.range ?? '');
      const from0 = m0 ? Number(m0[1]) : 0;
      res.writeHead(from0 ? 206 : 200, { 'content-length': String(OVERLONG.length - from0) });
      res.end(OVERLONG.subarray(from0));
      return;
    }
    const body = files[name]; if (!body) { res.writeHead(404).end(); return; }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const from = m && !opts.ignoreRange ? Number(m[1]) : 0;
    res.writeHead(from ? 206 : 200, { 'content-length': String(body.length - from) });
    if (opts.cutFirstAt && !cut && name === 'a.bin') { cut = true; res.write(body.subarray(from, opts.cutFirstAt), () => res.destroy()); return; }
    if (opts.holdAfter !== undefined && !held && name === 'a.bin') { held = true; res.write(body.subarray(from, opts.holdAfter)); return; } // send part, then never end (until the client aborts)
    res.end(body.subarray(from));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/repo/resolve/rev`;
});
afterEach(async () => {
  // Without this, some runs leave idle keep-alive sockets from earlier requests on this server (e.g.
  // after a retry loop makes several real round-trips before each attempt fails locally), and the
  // default server.close() waits for those to time out before its callback fires -- occasionally a
  // few seconds. Force them closed so afterEach is always fast and deterministic.
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  // maxRetries/retryDelay: tolerate a just-closed file handle (e.g. from an aborted read stream) that
  // Windows hasn't fully released yet, rather than letting a transient EBUSY/ENOTEMPTY fail the test.
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const manifest = (over: Partial<Record<string, string>> = {}): Manifest => ({
  baseUrl: base, files: [{ name: 'a.bin', size: A.length, sha256: over['a.bin'] ?? sha(A) }, { name: 'b.json', size: B.length, sha256: sha(B) }]
});
const make = (m = manifest(), free = 10 ** 12) => {
  const waits: number[] = [];
  const d = createDownloader({ dir, manifest: m, fetch, freeBytes: async () => free, wait: async (ms) => { waits.push(ms); } });
  return { d, waits };
};

describe('downloader', () => {
  it('downloads, verifies and becomes ready', async () => {
    const { d } = make(); expect(await d.init()).toEqual({ state: 'missing' });
    d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'ready' });
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
    expect(existsSync(join(dir, 'a.bin.part'))).toBe(false);
  });
  it('resumes a partial file with a Range request', async () => {
    writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 50_000));
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(reqs.find((r) => r.path === 'a.bin')?.range).toBe('bytes=50000-');
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('starts over when the server ignores Range', async () => {
    opts.ignoreRange = true; writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 50_000));
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'ready' });
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('retries a bad hash once, then reports bad_hash', async () => {
    const { d } = make(manifest({ 'a.bin': 'f'.repeat(64) })); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'error', reason: 'bad_hash' });
    expect(reqs.filter((r) => r.path === 'a.bin')).toHaveLength(2);
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
  });
  it('refuses to start without enough disk space', async () => {
    const { d } = make(manifest(), 1000); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'error', reason: 'no_space' });
    expect(reqs).toHaveLength(0);
  });
  it('backs off 5 s then 30 s on server errors, then succeeds', async () => {
    opts.fail = 2; const { d, waits } = make(); await d.init(); d.start(); await d.done();
    expect(waits).toEqual([5_000, 30_000]);
    expect(d.status()).toEqual({ state: 'ready' });
  });
  it('resumes after the connection drops mid-file', async () => {
    opts.cutFirstAt = 80_000; const { d } = make(); await d.init(); d.start(); await d.done();
    const ranges = reqs.filter((r) => r.path === 'a.bin').map((r) => r.range);
    expect(ranges[0]).toBeUndefined();
    expect(ranges[1]).toMatch(/^bytes=[1-9]\d*-$/); // resumed from whatever arrived before the drop
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('stop() mid-download leaves a genuine .part file; a later start() resumes it with Range', async () => {
    opts.holdAfter = 80_000;
    const { d } = make(); await d.init(); d.start();
    while (!existsSync(join(dir, 'a.bin.part')) || statSync(join(dir, 'a.bin.part')).size === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    d.stop(); await d.done();
    const partial = statSync(join(dir, 'a.bin.part')).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(A.length);
    expect(d.status()).toEqual({ state: 'missing' });
    opts.holdAfter = undefined;
    d.start(); await d.done();
    expect(reqs.filter((r) => r.path === 'a.bin').pop()?.range).toBe(`bytes=${partial}-`);
    expect(d.status()).toEqual({ state: 'ready' });
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('a corrupt marker file does not crash init(); the model is treated as missing', async () => {
    writeFileSync(join(dir, '.verified.json'), '{ not valid json');
    const { d } = make();
    await expect(d.init()).resolves.toEqual({ state: 'missing' });
  });
  it('remove() deletes only the manifest files, leaving unrelated files in dir untouched', async () => {
    const { d } = make(); await d.init(); d.start(); await d.done();
    writeFileSync(join(dir, 'unrelated.txt'), 'keep me');
    await d.remove();
    expect(d.status()).toEqual({ state: 'missing' });
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
    expect(existsSync(join(dir, 'b.json'))).toBe(false);
    expect(existsSync(join(dir, '.verified.json'))).toBe(false);
    expect(existsSync(join(dir, 'unrelated.txt'))).toBe(true);
    expect(readFileSync(join(dir, 'unrelated.txt'), 'utf8')).toBe('keep me');
  });
  it('a write failure (.part path occupied by a directory) surfaces as a retry, not a crash', async () => {
    // Simulates an fsp.open()/write() failure without relying on filesystem permissions, which
    // aren't reliably restrictable from a test on Windows. This exercises the same catch-and-retry
    // path a genuine mid-write disk error would take, since writes now go through fsp.open()/write()
    // (promise-based) instead of a WriteStream with an unhandled 'error' event. (A previous version of
    // this comment blamed fsp.open() on a directory for an occasional ~3s slowdown here; the real cause
    // was afterEach's server.close() waiting on idle keep-alive sockets left by this retry loop's many
    // real round-trips -- fixed by calling server.closeAllConnections() first, see afterEach above.)
    mkdirSync(join(dir, 'a.bin.part'));
    const { d, waits } = make();
    await d.init(); d.start();
    while (waits.length === 0) await new Promise((r) => setTimeout(r, 5));
    expect(d.status().state).toBe('downloading'); // still retrying, no uncaught exception
    d.stop(); await d.done();
  });
  it('rejects a response body that overruns the expected size, then reports bad_hash (no infinite retry)', async () => {
    opts.overlong = true;
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'error', reason: 'bad_hash' });
    expect(reqs.filter((r) => r.path === 'a.bin')).toHaveLength(2);
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
  });
  it('stop() that lands inside the re-hash of an already-complete .part leaves it untouched, not deleted or renamed', async () => {
    // Deterministic, not timing-based: the 'node:fs' mock above calls our hook just before the SECOND
    // chunk of this file's createReadStream read is handed to feed()'s for-await loop -- i.e. after the
    // first chunk has already been hashed, proving the stop() genuinely lands mid-read rather than
    // before any reading started or after the file was fully (re)hashed.
    writeFileSync(join(dir, 'a.bin.part'), A); // already fully downloaded, correct bytes; only needs a re-hash
    const d = createDownloader({ dir, manifest: manifest(), fetch, freeBytes: async () => 10 ** 12, wait: async () => {} });
    expect(await d.init()).toEqual({ state: 'missing' }); // only the .part exists, not the final file
    let hookFired = false;
    fsHooks.onSecondReadChunk = () => { hookFired = true; d.stop(); };
    d.start();
    await d.done();
    expect(hookFired).toBe(true); // sanity check that the hook (and thus the mid-read stop) actually happened
    expect(d.status()).toEqual({ state: 'missing' });
    expect(existsSync(join(dir, 'a.bin.part'))).toBe(true);
    expect(readFileSync(join(dir, 'a.bin.part')).equals(A)).toBe(true); // untouched, not truncated, deleted or corrupted
    expect(existsSync(join(dir, 'a.bin'))).toBe(false); // never renamed into place
    expect(reqs).toHaveLength(0); // the file was already fully sized on disk -- no fetch was ever needed
  });
  it('a rejected deletion inside remove() does not poison a later done(), but remove() itself still reports the failure', async () => {
    const { d } = make(); await d.init(); d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'ready' });
    fsHooks.failNextRm = true;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(d.remove()).rejects.toThrow(/EBUSY/);
      await expect(d.done()).resolves.toBeUndefined(); // the failed deletion must not leave `run` a rejected promise
      expect(d.status()).toEqual({ state: 'missing' }); // still reflects the intended end-state despite the partial failure
    } finally {
      consoleSpy.mockRestore();
    }
  });
  it('a start() during remove() runs after the deletion, and remove() does not clobber its status', async () => {
    // No timing tricks needed: everything up to remove()'s first `await` runs synchronously, so by the
    // time the second start() below executes, remove() has already stopped the first run and queued its
    // deletion -- deterministically exercising "start() lands in the middle of remove()".
    const { d } = make();
    await d.init();
    d.start(); // now downloading
    const removing = d.remove(); // stops the in-flight run and queues the deletion (status is 'missing' once this line returns)
    d.start(); // status is 'missing', so this queues a fresh run to start after remove()'s deletion finishes
    await removing;
    await d.done();
    expect(d.status()).toEqual({ state: 'ready' }); // the second start()'s download completed; remove() did not reset it back to 'missing' afterwards
    expect(readFileSync(join(dir, 'a.bin')).equals(A)).toBe(true);
  });
  it('stop() keeps the partial file and a restart resumes it', async () => {
    opts.fail = 1000;
    const waits: number[] = [];
    let release!: () => void;
    const d = createDownloader({ dir, manifest: manifest(), fetch, freeBytes: async () => 10 ** 12, wait: (ms, signal) => { waits.push(ms); return new Promise((r) => { release = r; signal.addEventListener('abort', () => r(), { once: true }); }); } });
    await d.init(); d.start();
    while (waits.length === 0) await new Promise((r) => setTimeout(r, 5));
    d.stop(); await d.done();
    expect(d.status()).toEqual({ state: 'missing' });
    writeFileSync(join(dir, 'a.bin.part'), A.subarray(0, 10_000));
    opts.fail = 0; d.start(); await d.done();
    expect(reqs.filter((r) => r.path === 'a.bin').pop()?.range).toBe('bytes=10000-');
    expect(d.status()).toEqual({ state: 'ready' });
    void release;
  });
  it('detects an existing verified model on init and rejects a tampered one', async () => {
    const first = make(); await first.d.init(); first.d.start(); await first.d.done();
    expect(await make().d.init()).toEqual({ state: 'ready' });
    const tampered = Buffer.from(A); tampered[0] ^= 0xff;
    writeFileSync(join(dir, 'a.bin'), tampered); utimesSync(join(dir, 'a.bin'), new Date(), new Date(Date.now() + 5000));
    expect(await make().d.init()).toEqual({ state: 'missing' });
  });
  it('remove() deletes the model', async () => {
    const { d } = make(); await d.init(); d.start(); await d.done();
    await d.remove();
    expect(d.status()).toEqual({ state: 'missing' });
    expect(existsSync(join(dir, 'a.bin'))).toBe(false);
  });
});

describe('downloader (readOnly: a dev model folder is never modified)', () => {
  const makeRO = () => createDownloader({ dir, manifest: manifest(), fetch, freeBytes: async () => 10 ** 12, wait: async () => {}, readOnly: true });
  const snapshot = () => Object.fromEntries(['a.bin', 'b.json', '.verified.json', 'a.bin.part'].map((f) => [f, existsSync(join(dir, f)) ? readFileSync(join(dir, f)).toString('hex') : null]));

  it('init() reports ready for a good model without writing a marker', async () => {
    writeFileSync(join(dir, 'a.bin'), A); writeFileSync(join(dir, 'b.json'), B);
    const before = snapshot();
    expect(await makeRO().init()).toEqual({ state: 'ready' });
    expect(snapshot()).toEqual(before);
  });
  it('init() reports missing for a file with a bad hash but never deletes it', async () => {
    const tampered = Buffer.from(A); tampered[0] ^= 0xff;
    writeFileSync(join(dir, 'a.bin'), tampered); writeFileSync(join(dir, 'b.json'), B);
    const before = snapshot();
    expect(await makeRO().init()).toEqual({ state: 'missing' });
    expect(snapshot()).toEqual(before);
  });
  it('init() does not create a missing folder', async () => {
    rmSync(dir, { recursive: true, force: true });
    expect(await makeRO().init()).toEqual({ state: 'missing' });
    expect(existsSync(dir)).toBe(false);
    mkdirSync(dir); // afterEach cleans up
  });
  it('start() and remove() are no-ops: nothing is fetched, written or deleted', async () => {
    writeFileSync(join(dir, 'b.json'), B); // a.bin missing: a normal downloader would fetch it
    const d = makeRO();
    await d.init();
    const before = snapshot();
    d.start(); await d.done();
    expect(d.status()).toEqual({ state: 'missing' });
    await d.remove();
    expect(reqs).toHaveLength(0);
    expect(snapshot()).toEqual(before);
  });
});
