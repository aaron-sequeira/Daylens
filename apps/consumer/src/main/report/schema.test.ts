import { describe, it, expect } from 'vitest';
import { parsePlanItem, parseReport, REPORT_JSON_SCHEMA } from './schema';

const ids = new Set(['stuck:e1', 'nudge:7']);
const good = { headline: 'A focused morning', story: 'You coded.', wins: ['a'], habits: ['b'],
  doBetter: [{ candidateId: 'stuck:e1', what: 'w', better: 'b' }], plan: [{ text: 'Block 9:30', kind: 'focus_block', payload: { start: '09:30', minutes: 90 } }], advice: 'Rest.' };

describe('report schema', () => {
  it('accepts a good report', () => { expect(parseReport(good, ids)).toEqual(good); });
  it('drops doBetter items whose candidateId is not a real candidate (grounding guard)', () => {
    const r = parseReport({ ...good, doBetter: [...good.doBetter, { candidateId: 'made:up', what: 'x', better: 'y' }] }, ids);
    expect(r?.doBetter.map((d) => d.candidateId)).toEqual(['stuck:e1']);
  });
  it('drops invalid plan items one by one', () => {
    const plan = [good.plan[0], { text: 'x', kind: 'focus_block', payload: { start: '25:00', minutes: 90 } }, { text: 'x', kind: 'app_cap', payload: { app: 'YouTube', minutes: 5 } },
      { text: 'Breaks every 40', kind: 'break_interval', payload: { minutes: 40 } }, { text: 'x', kind: 'nap', payload: {} }, { text: 'Bed by 23:00', kind: 'wind_down', payload: { time: '23:00' } }];
    expect(parseReport({ ...good, plan }, ids)?.plan.map((p) => p.kind)).toEqual(['focus_block', 'break_interval', 'wind_down']);
  });
  it('truncates long strings and extra list items instead of rejecting', () => {
    const r = parseReport({ ...good, headline: 'h'.repeat(200), wins: ['1', '2', '3', '4', '5'], advice: 'a'.repeat(400) }, ids)!;
    expect(r.headline).toHaveLength(80);
    expect(r.wins).toHaveLength(3);
    expect(r.advice).toHaveLength(300);
  });
  it('rejects a report without a headline or that is not an object', () => {
    expect(parseReport({ ...good, headline: '' }, ids)).toBeNull();
    expect(parseReport('nope', ids)).toBeNull();
    expect(parseReport(null, ids)).toBeNull();
  });
  it('tolerates missing optional lists', () => {
    expect(parseReport({ headline: 'H', story: 'S', advice: 'A' }, ids)).toMatchObject({ wins: [], habits: [], doBetter: [], plan: [] });
  });
  it('validates a lone plan item', () => {
    expect(parsePlanItem({ text: 'Cap', kind: 'app_cap', payload: { app: 'Discord', minutes: 60 } })).toMatchObject({ kind: 'app_cap' });
    expect(parsePlanItem({ text: 'x', kind: 'wind_down', payload: { time: '9pm' } })).toBeNull();
  });
  it('exposes a JSON schema for the grammar', () => {
    expect(REPORT_JSON_SCHEMA).toMatchObject({ type: 'object', required: expect.arrayContaining(['headline', 'story', 'advice']) });
  });
});
