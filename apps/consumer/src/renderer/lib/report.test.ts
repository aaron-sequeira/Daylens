import { describe, it, expect } from 'vitest';
import { activePercent, detailPanels, goalPercent, reportCardKind, reportDateLabel, waitingText, words } from './report';

describe('report UI helpers', () => {
  it('labels dates relative to today', () => {
    expect(reportDateLabel('2026-09-26', '2026-09-26')).toBe('Today');
    expect(reportDateLabel('2026-09-25', '2026-09-26')).toBe('Yesterday');
    expect(reportDateLabel('2026-09-20', '2026-09-26')).toMatch(/Sun(day)?,? 20 Sep/);
  });
  it('splits the story into words for the reveal', () => { expect(words(' You  coded all morning. ')).toEqual(['You', 'coded', 'all', 'morning.']); });
  it('computes goal usage', () => { expect(goalPercent({ screenSec: 3600, goalSec: 7200 } as never)).toBe(50); expect(goalPercent({ screenSec: 1, goalSec: 0 } as never)).toBe(0); });
  it('caps active time at 100% of screen time even if activeSec is somehow larger', () => {
    expect(activePercent({ screenSec: 3600, activeSec: 1800 } as never)).toBe(50);
    expect(activePercent({ screenSec: 3600, activeSec: 7200 } as never)).toBe(100);
    expect(activePercent({ screenSec: 0, activeSec: 100 } as never)).toBe(0);
  });
  it('picks the card to show above the stats', () => {
    const v = (o: object) => ({ status: 'none', writer: { state: 'ready', mode: 'local', model: 'm' }, waiting: false, running: false, stats: { screenSec: 100 }, ...o }) as never;
    expect(reportCardKind(v({ status: 'ready' }))).toBe('report');
    expect(reportCardKind(v({ running: true }))).toBe('writing');
    expect(reportCardKind(v({ status: 'pending' }))).toBe('writing');
    expect(reportCardKind(v({ waiting: true }))).toBe('waiting');
    expect(reportCardKind(v({ status: 'failed' }))).toBe('failed');
    expect(reportCardKind(v({ writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('download');
    expect(reportCardKind(v({ writer: { state: 'unavailable', reason: 'low_ram', text: 't' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ writer: { state: 'cloud_setup' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ status: 'failed', writer: { state: 'unavailable', reason: 'low_ram', text: 't' } }))).toBe('cloud_offer');
    // A writer that can't run outranks "waiting": waiting for memory is pointless without one.
    expect(reportCardKind(v({ waiting: true, writer: { state: 'cloud_setup' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ waiting: true, writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('download');
    expect(reportCardKind(v({ waiting: true, status: 'failed' }))).toBe('waiting'); // a retry of a failed day that's queued
    expect(reportCardKind(v({ queued: true }))).toBe('waiting'); // queued behind another day's write
    expect(reportCardKind(v({ stats: { screenSec: 0 } }))).toBe('empty');
    expect(reportCardKind(v({}))).toBe('generate');
  });
  it('lists only the non-empty detail panels, in order, with their rows', () => {
    const empty = { apps: [], sites: [], videos: [], games: [], learning: [] };
    expect(detailPanels(empty)).toEqual([]);
    const panels = detailPanels({ ...empty, apps: [{ app: 'Code', min: 90 }], sites: [{ site: 'GitHub', min: 20, pages: ['Repo'] }], learning: [{ title: 'Closures', where: 'MDN Web Docs', min: 5 }] });
    expect(panels.map((p) => p.title)).toEqual(['Apps', 'Websites', 'Learning']);
    expect(panels[0].rows).toEqual([{ name: 'Code', min: 90, sub: [] }]);
    expect(panels[1].rows).toEqual([{ name: 'GitHub', min: 20, sub: ['Repo'] }]);
    expect(panels[2].rows).toEqual([{ name: 'Closures', min: 5, sub: ['MDN Web Docs'] }]);
    const v = detailPanels({ ...empty, videos: [{ title: 'Lofi', site: 'YouTube', min: 25 }], games: [{ name: 'Hades', min: 30 }] });
    expect(v).toEqual([{ title: 'Videos', rows: [{ name: 'Lofi', min: 25, sub: ['YouTube'] }] }, { title: 'Games', rows: [{ name: 'Hades', min: 30, sub: [] }] }]);
  });
  it('explains a queued write with the real memory numbers', () => {
    const local = { writer: { state: 'ready', mode: 'local', model: 'm' }, needGb: 2.1, freeGb: 0.4 } as never;
    expect(waitingText(local, true)).toBe('Waiting for memory to rewrite: needs 2.1 GB free, 0.4 GB free now. It starts by itself when memory frees up.');
    expect(waitingText(local, false)).toBe('Waiting for memory to write: needs 2.1 GB free, 0.4 GB free now. It starts by itself when memory frees up.');
    // Enough memory (or cloud): it's waiting on another Daylens job, not memory.
    const enough = { writer: { state: 'ready', mode: 'local', model: 'm' }, needGb: 2.1, freeGb: 3 } as never;
    expect(waitingText(enough, true)).toMatch(/^Waiting for Daylens to finish another job/);
    const cloud = { writer: { state: 'ready', mode: 'cloud', model: 'm' }, needGb: 2.1, freeGb: 0.4 } as never;
    expect(waitingText(cloud, false)).toMatch(/^Waiting for Daylens to finish another job/);
  });
});
