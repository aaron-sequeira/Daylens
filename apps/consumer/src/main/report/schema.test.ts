import { describe, it, expect } from 'vitest';
import { groundNumbers, normalizeVoice, parsePlanItem, parseReport, REPORT_JSON_SCHEMA, type ReportJson } from './schema';

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
  it('caps every string in the grammar at the length parseReport keeps', () => {
    const len = (s: unknown) => (s as { maxLength?: number }).maxLength;
    const p = (REPORT_JSON_SCHEMA as any).properties;
    expect([len(p.headline), len(p.story), len(p.wins.items), len(p.habits.items), len(p.advice)]).toEqual([80, 900, 200, 200, 300]);
    const db = p.doBetter.items.properties, plan = p.plan.items.properties;
    expect([len(db.candidateId), len(db.what), len(db.better)]).toEqual([40, 240, 240]);
    expect([len(plan.text), len(plan.payload.properties.app), len(plan.payload.properties.start), len(plan.payload.properties.time)]).toEqual([160, 60, 5, 5]);
  });
  it('skips blank list items before capping the count', () => {
    expect(parseReport({ ...good, wins: ['', '  ', 7, 'a', 'b', 'c', 'd'], habits: [null, 'h'] }, ids)).toMatchObject({ wins: ['a', 'b', 'c'], habits: ['h'] });
  });
});

const bare = (o: Partial<ReportJson> = {}): ReportJson =>
  ({ headline: 'A day', story: '', wins: [], habits: [], doBetter: [], plan: [], advice: '', ...o });

describe('normalizeVoice', () => {
  it('turns a sentence-start "I" into "You", mid-sentence "I" into "you"', () => {
    const r = normalizeVoice(bare({ story: 'I coded a lot today. You focused well, but I got distracted after lunch.' }));
    expect(r.story).toBe('You coded a lot today. You focused well, but you got distracted after lunch.');
  });
  it('rewrites my/me/myself/I\'m/I\'ve at word boundaries', () => {
    const r = normalizeVoice(bare({
      story: "My focus was good. Trust me, I'm proud of myself. I've done well.",
      wins: ['I kept my streak going'], habits: ['My evenings ran long'], advice: 'Watch my screen time.',
      doBetter: [{ candidateId: 'x', what: 'I got stuck searching', better: 'Try my bookmarks instead' }]
    }));
    expect(r.story).toBe("Your focus was good. Trust you, you're proud of yourself. You've done well.");
    expect(r.wins).toEqual(['You kept your streak going']);
    expect(r.habits).toEqual(['Your evenings ran long']);
    expect(r.advice).toBe('Watch your screen time.');
    expect(r.doBetter).toEqual([{ candidateId: 'x', what: 'You got stuck searching', better: 'Try your bookmarks instead' }]);
  });
  it('does not touch words that merely contain these substrings', () => {
    const r = normalizeVoice(bare({ story: 'You came home and started a meeting about my_project immediately.' }));
    expect(r.story).toBe('You came home and started a meeting about my_project immediately.');
  });
  it('leaves headline and plan untouched', () => {
    const r = normalizeVoice(bare({ headline: 'My best day', plan: [{ text: 'my plan', kind: 'break_interval', payload: { minutes: 30 } }] }));
    expect(r.headline).toBe('My best day');
    expect(r.plan[0].text).toBe('my plan');
  });
});

describe('groundNumbers', () => {
  it('drops a wins/habits/doBetter/advice item that mentions an ungrounded duration', () => {
    const r = groundNumbers(bare({
      wins: ['a 60-minute deep-work streak', 'a solid morning'],
      habits: ['3 hours of late scrolling', 'kept it low-key'],
      advice: 'Try a 45 min focus block.',
      doBetter: [{ candidateId: 'x', what: 'Stuck for 20 minutes', better: 'use a shortcut' }, { candidateId: 'y', what: 'ok', better: 'ok' }]
    }), [0, 11]);
    expect(r.wins).toEqual(['a solid morning']);
    expect(r.habits).toEqual(['kept it low-key']);
    expect(r.advice).toBe('');
    expect(r.doBetter).toEqual([{ candidateId: 'y', what: 'ok', better: 'ok' }]);
  });
  it('keeps a mention that matches an allowed number within tolerance', () => {
    const r = groundNumbers(bare({ wins: ['your 11 minutes on Chrome'] }), [11]);
    expect(r.wins).toEqual(['your 11 minutes on Chrome']);
    const r2 = groundNumbers(bare({ wins: ['about 12 minutes on Chrome'] }), [11]); // +-1 tolerance
    expect(r2.wins).toEqual(['about 12 minutes on Chrome']);
  });
  it('treats hour mentions as their minute equivalent', () => {
    const r = groundNumbers(bare({ wins: ['a solid 1 hour focus session'] }), [60]);
    expect(r.wins).toEqual(['a solid 1 hour focus session']);
    const r2 = groundNumbers(bare({ wins: ['a solid 2 hour focus session'] }), [60]);
    expect(r2.wins).toEqual([]);
  });
  it('removes only the offending sentence from story, falls back to "Your day" if headline is emptied', () => {
    const r = groundNumbers(bare({
      headline: 'A 60-minute win',
      story: 'You started slow. You then had a 90-minute deep-work streak. Later you relaxed.'
    }), [30]);
    expect(r.headline).toBe('Your day');
    expect(r.story).toBe('You started slow. Later you relaxed.');
  });
  it('leaves a report with no invented numbers untouched', () => {
    const good = bare({ headline: 'A steady day', story: 'You had a calm morning.', wins: ['You kept a steady pace.'], advice: 'Keep it up.' });
    expect(groundNumbers(good, [])).toEqual(good);
  });
  it('reads a combined "Xh Ym" mention as one value, not just its hours part', () => {
    const kept = groundNumbers(bare({ wins: ['a 5h 40m deep-work block'] }), [340]);
    expect(kept.wins).toEqual(['a 5h 40m deep-work block']);
    const dropped = groundNumbers(bare({ wins: ['a 5h 40m deep-work block'] }), [300]); // the hours-only value must not save it
    expect(dropped.wins).toEqual([]);
    // Old bug: "20h 59m" passed because only the hours part (1200) was ever checked, and it happened to round
    // near an allowed value. The real total (1259) must be what's compared.
    const longDropped = groundNumbers(bare({ wins: ['spent 20h 59m online'] }), [1234]);
    expect(longDropped.wins).toEqual([]);
    const longKept = groundNumbers(bare({ wins: ['spent 20h 59m online'] }), [1259]);
    expect(longKept.wins).toEqual(['spent 20h 59m online']);
  });
  it('accepts a bare "m" as minutes when not part of a combined "Xh Ym" mention', () => {
    const kept = groundNumbers(bare({ wins: ['a quick 40m break'] }), [40]);
    expect(kept.wins).toEqual(['a quick 40m break']);
    const dropped = groundNumbers(bare({ wins: ['a quick 40m break'] }), [10]);
    expect(dropped.wins).toEqual([]);
  });
});
