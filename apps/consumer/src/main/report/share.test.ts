import { describe, it, expect } from 'vitest';
import { autoSavePath, autoSavePdf, mailtoUrl } from './share';
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
});
