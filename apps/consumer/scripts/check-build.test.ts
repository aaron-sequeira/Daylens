import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkBuild, REQUIRED } from './check-build.mjs';

let root: string;
const touch = (rel: string, bytes = 10) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.alloc(bytes)); };
const good = () => { for (const r of REQUIRED) touch(r.probe); };

describe('checkBuild', () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dl-build-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes a complete, lean build', () => {
    good();
    expect(checkBuild(root)).toMatchObject({ ok: true, problems: [] });
  });
  it('fails when a required native part is missing', () => {
    good();
    rmSync(join(root, REQUIRED[0].probe));
    const r = checkBuild(root);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain(REQUIRED[0].label);
  });
  it('fails when a CUDA or Mac package sneaks in', () => {
    good();
    touch('resources/app/node_modules/@node-llama-cpp/win-x64-cuda/bins/x.node');
    touch('resources/app/node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/x.node');
    const r = checkBuild(root);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/win-x64-cuda/);
    expect(r.problems.join('\n')).toMatch(/darwin/);
  });
  it('fails over the size limit and names the biggest directories', () => {
    good();
    touch('resources/app/node_modules/huge/blob.bin', 2000);
    const r = checkBuild(root, { maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/huge/);
  });
});
