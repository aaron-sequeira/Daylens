import { describe, it, expect } from 'vitest';
import { deltaText, summaryCardKind, weekLabel, weekReady } from './insights';

describe('weekLabel', () => {
  it('names this week and last week relative to today', () => {
    expect(weekLabel('2026-09-28', '2026-09-30')).toBe('This week'); // today is the Wednesday of that week
    expect(weekLabel('2026-09-21', '2026-09-30')).toBe('Last week');
  });
  it('formats a week within one month as "22–28 Sep"', () => {
    expect(weekLabel('2026-09-22', '2026-10-20')).toBe('22–28 Sep');
  });
  it('formats a week across a month boundary as "29 Sep – 5 Oct"', () => {
    expect(weekLabel('2026-09-29', '2026-11-01')).toBe('29 Sep – 5 Oct');
  });
});

describe('deltaText', () => {
  it('is blank with nothing to compare', () => {
    expect(deltaText(100, null)).toBe('');
    expect(deltaText(100, 0)).toBe('');
  });
  it('says "same as last week" when unchanged', () => {
    expect(deltaText(100, 100)).toBe('same as last week');
  });
  it('shows an up arrow when higher, a down arrow when lower', () => {
    expect(deltaText(112, 100)).toBe('↑ 12% vs last week');
    expect(deltaText(95, 100)).toBe('↓ 5% vs last week');
  });
});

describe('weekReady', () => {
  it('is only ready for the current week from its Sunday onward', () => {
    expect(weekReady('2026-09-28', '2026-09-30')).toBe(false); // Wednesday of the current week
    expect(weekReady('2026-09-28', '2026-10-04')).toBe(true); // Sunday of the current week
  });
  it('is always ready for a week that has already finished', () => {
    expect(weekReady('2026-09-14', '2026-09-20')).toBe(true); // asked on that week's own Sunday
    expect(weekReady('2026-09-14', '2026-10-20')).toBe(true);
  });
});

describe('summaryCardKind', () => {
  const v = (o: object) => ({
    numbers: { totals: { activeDays: 5 } }, row: null,
    writer: { state: 'ready', mode: 'local', model: 'm' }, waiting: false, running: false, queued: false, ...o
  }) as never;

  it('follows precedence: summary > writing > waiting > cloud_offer > failed > download > notEnough > generate', () => {
    expect(summaryCardKind(v({ row: { status: 'ready' } }))).toBe('summary');
    expect(summaryCardKind(v({ running: true }))).toBe('writing');
    expect(summaryCardKind(v({ row: { status: 'pending' } }))).toBe('writing');
    expect(summaryCardKind(v({ waiting: true }))).toBe('waiting');
    expect(summaryCardKind(v({ queued: true }))).toBe('waiting');
    expect(summaryCardKind(v({ writer: { state: 'cloud_setup' } }))).toBe('cloud_offer');
    expect(summaryCardKind(v({ writer: { state: 'unavailable', reason: 'low_ram', text: 't' } }))).toBe('cloud_offer');
    expect(summaryCardKind(v({ row: { status: 'failed' } }))).toBe('failed');
    expect(summaryCardKind(v({ writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('download');
    // Waiting outranks cloud_offer here (unlike daily reports): the week's own precedence list.
    expect(summaryCardKind(v({ waiting: true, writer: { state: 'cloud_setup' } }))).toBe('waiting');
    expect(summaryCardKind(v({ row: { status: 'failed' }, writer: { state: 'missing', tier: '4b', sizeBytes: 1 } }))).toBe('failed');
    expect(summaryCardKind(v({ numbers: { totals: { activeDays: 2 } } }))).toBe('notEnough');
    expect(summaryCardKind(v({ numbers: { totals: { activeDays: 2 } }, row: { status: 'failed' } }))).toBe('failed');
    expect(summaryCardKind(v({}))).toBe('generate');
  });
});
