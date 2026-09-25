import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDownloader, type Manifest } from './downloader';

const A = randomBytes(200_000), B = randomBytes(1_000);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
type Opts = { ignoreRange?: boolean; fail?: number; cutFirstAt?: number };
let server: Server; let base: string; let dir: string; let reqs: { path: string; range?: string }[]; let opts: Opts;
const files: Record<string, Buffer> = { 'a.bin': A, 'b.json': B };

beforeEach(async () => {
  reqs = []; opts = {}; dir = mkdtempSync(join(tmpdir(), 'dl-'));
  let cut = false;
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    reqs.push({ path: name, range: req.headers.range });
    if (opts.fail && opts.fail > 0) { opts.fail--; res.writeHead(500).end(); return; }
    const body = files[name]; if (!body) { res.writeHead(404).end(); return; }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const from = m && !opts.ignoreRange ? Number(m[1]) : 0;
    res.writeHead(from ? 206 : 200, { 'content-length': String(body.length - from) });
    if (opts.cutFirstAt && !cut && name === 'a.bin') { cut = true; res.write(body.subarray(from, opts.cutFirstAt), () => res.destroy()); return; }
    res.end(body.subarray(from));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/repo/resolve/rev`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

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
