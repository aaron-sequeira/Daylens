import { describe, it, expect } from 'vitest';
import { activePercent, detailPanels, EMAIL_IDLE, emailFinished, emailStart, goalPercent, nextIndex, pickDate, reportCardKind, reportDateLabel, snippetParts, waitingText, words } from './report';

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
  it('explains a queued write with the real memory numbers when main says memory is short', () => {
    const short = { memoryShort: true, needGb: 2.1, freeGb: 0.4 } as never;
    expect(waitingText(short, true)).toBe('Waiting for memory to rewrite: needs 2.1 GB free, 0.4 GB free now. It starts by itself when memory frees up.');
    expect(waitingText(short, false)).toBe('Waiting for memory to write: needs 2.1 GB free, 0.4 GB free now. It starts by itself when memory frees up.');
    // Rounded GB can look equal (2.1 vs 2.1) while the bytes are short: the byte-exact flag from main decides.
    expect(waitingText({ memoryShort: true, needGb: 2.1, freeGb: 2.1 } as never, true)).toMatch(/^Waiting for memory/);
    // Enough memory (or cloud): it's waiting on another Daylens job, not memory.
    expect(waitingText({ memoryShort: false, needGb: 2.1, freeGb: 0.4 } as never, true)).toMatch(/^Waiting for Daylens to finish another job/);
  });
  it('splits a search snippet into plain and highlighted parts on the control-character markers, never a literal [ or ]', () => {
    expect(snippetParts('You worked in \u0001Figma\u0002 all day')).toEqual([
      { text: 'You worked in ', mark: false }, { text: 'Figma', mark: true }, { text: ' all day', mark: false }
    ]);
    expect(snippetParts('\u0001Figma\u0002 again, then \u0001YouTube\u0002')).toEqual([
      { text: 'Figma', mark: true }, { text: ' again, then ', mark: false }, { text: 'YouTube', mark: true }
    ]);
    expect(snippetParts('no matches here')).toEqual([{ text: 'no matches here', mark: false }]);
    // A literal bracket typed in a report is never mistaken for a match marker.
    expect(snippetParts('You wrote [TODO] in the file')).toEqual([{ text: 'You wrote [TODO] in the file', mark: false }]);
    expect(snippetParts('')).toEqual([]);
  });
  it('cycles the highlighted search result with the arrow keys, wrapping at both ends', () => {
    expect(nextIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextIndex(2, 3, 'ArrowUp')).toBe(1);
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1);
    expect(nextIndex(1, 3, 'Enter')).toBe(1); // any other key leaves the index unchanged
  });
  it('accepts a picked date only within [min, max] and from year 2000 on', () => {
    expect(pickDate('2026-09-20', '2026-01-05', '2026-09-28')).toBe('2026-09-20');
    expect(pickDate('', '2026-01-05', '2026-09-28')).toBeNull();
    expect(pickDate('2026-09-29', '2026-01-05', '2026-09-28')).toBeNull(); // future
    expect(pickDate('2025-12-31', '2026-01-05', '2026-09-28')).toBeNull(); // before the oldest day
    expect(pickDate('0026-09-20', undefined, '2026-09-28')).toBeNull(); // a half-typed year
    expect(pickDate('2026-09-20', undefined, '2026-09-28')).toBe('2026-09-20');
  });
  it('tracks the Email button as busy from start to finish, so a second click while it is in flight is a no-op', () => {
    expect(EMAIL_IDLE).toEqual({ pending: false, status: null });
    const started = emailStart();
    expect(started).toEqual({ pending: true, status: null }); // busy, and any old note is cleared
    expect(emailFinished(null)).toEqual({ pending: false, status: null }); // ok: no longer busy, nothing to show
    expect(emailFinished('Could not open an email draft.')).toEqual({ pending: false, status: 'Could not open an email draft.' });
  });
});
