import { describe, it, expect } from 'vitest';
import { goalPercent, reportCardKind, reportDateLabel, words } from './report';

describe('report UI helpers', () => {
  it('labels dates relative to today', () => {
    expect(reportDateLabel('2026-09-26', '2026-09-26')).toBe('Today');
    expect(reportDateLabel('2026-09-25', '2026-09-26')).toBe('Yesterday');
    expect(reportDateLabel('2026-09-20', '2026-09-26')).toMatch(/Sun(day)?,? 20 Sep/);
  });
  it('splits the story into words for the reveal', () => { expect(words(' You  coded all morning. ')).toEqual(['You', 'coded', 'all', 'morning.']); });
  it('computes goal usage', () => { expect(goalPercent({ screenSec: 3600, goalSec: 7200 } as never)).toBe(50); expect(goalPercent({ screenSec: 1, goalSec: 0 } as never)).toBe(0); });
  it('picks the card to show above the stats', () => {
    const v = (o: object) => ({ status: 'none', writer: { state: 'ready', mode: 'local', model: 'm' }, waiting: false, running: false, stats: { screenSec: 100 }, ...o }) as never;
    expect(reportCardKind(v({ status: 'ready' }))).toBe('report');
    expect(reportCardKind(v({ running: true }))).toBe('writing');
    expect(reportCardKind(v({ waiting: true }))).toBe('waiting');
    expect(reportCardKind(v({ status: 'failed' }))).toBe('failed');
    expect(reportCardKind(v({ writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('download');
    expect(reportCardKind(v({ writer: { state: 'unavailable', reason: 'low_ram', text: 't' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ writer: { state: 'cloud_setup' } }))).toBe('cloud_offer');
    expect(reportCardKind(v({ stats: { screenSec: 0 } }))).toBe('empty');
    expect(reportCardKind(v({}))).toBe('generate');
  });
});
