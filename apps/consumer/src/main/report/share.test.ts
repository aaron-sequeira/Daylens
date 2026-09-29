import { describe, it, expect } from 'vitest';
import { autoSavePath, autoSavePdf, checkFolder, createFolderChecker, mailtoUrl } from './share';
import type { ReportJson } from './schema';

const rep: ReportJson = { headline: 'A focused morning', story: 'One. Two! Three? Four.', wins: [], habits: [], doBetter: [], plan: [], advice: 'a' };
describe('share', () => {
  it('builds the auto-save path', () => { expect(autoSavePath('C:\\Reports', '2026-09-26')).toMatch(/Reports[\\/]Daylens-2026-09-26\.pdf$/); });
  it('builds an encoded mailto with the headline and up to three sentences', () => {
    const u = mailtoUrl('2026-09-26', rep);
    expect(u.startsWith('mailto:?subject=')).toBe(true);
    const body = decodeURIComponent(u.split('&body=')[1]);
    expect(decodeURIComponent(u.split('subject=')[1].split('&')[0])).toBe('Daylens — 2026-09-26');
    expect(body).toContain('A focused morning');
    expect(body).toContain('One. Two! Three?');
    expect(body).not.toContain('Four');
    expect(mailtoUrl('2026-09-26', { ...rep, story: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(1800);
    expect(decodeURIComponent(mailtoUrl('2026-09-26', null).split('&body=')[1])).toMatch(/Daylens report/);
  });
  it('truncates by code point so a surrogate pair (emoji) landing on the cut never throws', () => {
    // One long "sentence" of emoji (each a surrogate pair): a plain UTF-16 slice() has a good chance of
    // landing mid-pair on at least one of the repeated 10%-off-the-end truncation passes this needs.
    const story = `x${'🎉'.repeat(2000)}.`;
    expect(() => mailtoUrl('2026-09-26', { ...rep, story })).not.toThrow();
    expect(mailtoUrl('2026-09-26', { ...rep, story }).length).toBeLessThanOrEqual(1800);
  });
  it('auto-saves atomically (tmp then rename), reports off, and reports failures without throwing', async () => {
    const written: string[] = [];
    const renamed: Array<[string, string]> = [];
    const deps = {
      render: async () => Buffer.from('%PDF'),
      write: async (p: string) => { written.push(p); },
      exists: async () => true,
      rename: async (from: string, to: string) => { renamed.push([from, to]); }
    };
    expect(await autoSavePdf('2026-09-26', '', deps)).toBe('off');
    expect(await autoSavePdf('2026-09-26', 'C:\\R', deps)).toBe('ok');
    expect(written[0]).toMatch(/Daylens-2026-09-26\.pdf\.tmp$/);
    expect(renamed[0][0]).toBe(written[0]);
    expect(renamed[0][1]).toMatch(/Daylens-2026-09-26\.pdf$/);
    expect(await autoSavePdf('2026-09-26', 'C:\\Gone', { ...deps, exists: async () => false })).toMatch(/folder/i);
    expect(await autoSavePdf('2026-09-26', 'C:\\R', { ...deps, write: async () => { throw new Error('EACCES: permission denied'); } })).toMatch(/permission/i);
    expect(await autoSavePdf('2026-09-26', 'C:\\R', { ...deps, rename: async () => { throw new Error('boom'); } })).toMatch(/couldn't be saved/i);
  });
  it('skips (and removes the temp file) when the report was deleted while rendering', async () => {
    const calls: string[] = [];
    const r = await autoSavePdf('2026-09-28', 'C:\\out', {
      render: async () => Buffer.from('pdf'), write: async (p) => { calls.push(`write ${p}`); },
      exists: async () => true, rename: async () => { calls.push('rename'); },
      stillValid: () => false, remove: async (p) => { calls.push(`remove ${p}`); }
    });
    expect(r).toBe('skipped');
    expect(calls).not.toContain('rename');
    expect(calls.some((c) => c.startsWith('remove') && c.endsWith('.tmp'))).toBe(true);
  });
});

describe('checkFolder', () => {
  const dir = { isDirectory: () => true }, file = { isDirectory: () => false };
  const err = (code: string) => Object.assign(new Error(code), { code });
  it('ok for a directory, missing for ENOENT/ENOTDIR or a file', async () => {
    expect(await checkFolder('x', async () => dir)).toBe('ok');
    expect(await checkFolder('x', async () => file)).toBe('missing');
    expect(await checkFolder('x', async () => { throw err('ENOENT'); })).toBe('missing');
    expect(await checkFolder('x', async () => { throw err('ENOTDIR'); })).toBe('missing');
  });
  it('unknown (no warning) for other errors or an unreachable share that never answers', async () => {
    expect(await checkFolder('x', async () => { throw err('EACCES'); })).toBe('unknown');
    expect(await checkFolder('\\\\gone\\share', () => new Promise(() => {}), 20)).toBe('unknown');
  });
});

describe('createFolderChecker', () => {
  const dir = { isDirectory: () => true };
  it('shares one in-flight stat across concurrent calls for the same folder', async () => {
    let calls = 0; let now = 0;
    let resolveStat!: () => void;
    const stat = () => { calls++; return new Promise<typeof dir>((res) => { resolveStat = () => res(dir); }); };
    const check = createFolderChecker(stat, () => now);
    const p1 = check('C:\\Share');
    const p2 = check('C:\\Share');
    expect(calls).toBe(1); // second call joined the first's in-flight stat, no new one started
    resolveStat();
    expect(await p1).toBe('ok');
    expect(await p2).toBe('ok');
  });
  it('reuses a result within the ttl and re-checks once it expires', async () => {
    let calls = 0; let now = 0;
    const stat = async () => { calls++; return dir; };
    const check = createFolderChecker(stat, () => now, 30_000);
    expect(await check('C:\\Share')).toBe('ok');
    expect(calls).toBe(1);
    now += 10_000;
    expect(await check('C:\\Share')).toBe('ok');
    expect(calls).toBe(1); // still within the 30s ttl: cached, no new stat
    now += 30_000;
    expect(await check('C:\\Share')).toBe('ok');
    expect(calls).toBe(2); // ttl expired: a fresh stat runs
  });
  it('a different folder bypasses the cache and triggers its own stat', async () => {
    let calls = 0; let now = 0;
    const stat = async () => { calls++; return dir; };
    const check = createFolderChecker(stat, () => now);
    expect(await check('C:\\A')).toBe('ok');
    expect(await check('C:\\B')).toBe('ok');
    expect(calls).toBe(2);
  });
});
