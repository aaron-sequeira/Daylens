import { describe, it, expect } from 'vitest';
import { read, sess, snap, T } from './fixtures';
import type { Candidate } from './types';
import { parseTip, REWRITE_RULES, tipAllowedMinutes, tipInput, tipPrompt, tipRewriteAllowed, type TipInput } from './tip';

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  ruleId: 'stuck_tip', kind: 'tip', key: 'stuck_tip:a', mini: 'Stuck?', stat: 'stuck',
  title: 'Stuck in Code?', body: 'Looks like you have been stuck. Try a 5-min walk.',
  primary: { label: 'Got it', action: 'ack' }, ...o
});

describe('REWRITE_RULES', () => {
  it('only covers stuck_tip and repeat_search', () => {
    expect(REWRITE_RULES.has('stuck_tip')).toBe(true);
    expect(REWRITE_RULES.has('repeat_search')).toBe(true);
    expect(REWRITE_RULES.has('goal_80')).toBe(false);
  });
});

describe('tipInput', () => {
  it('takes app/title from the latest read in readsToday', () => {
    const reads = [read(T(11, 50), 'Code', { windowTitle: 'old.ts - Code' }), read(T(11, 56), 'Code', { windowTitle: 'main.ts - Code' })];
    const input = tipInput(cand(), snap({ readsToday: reads, now: T(11, 57) }), []);
    expect(input.app).toBe('Code');
    expect(input.title).toBe('main.ts - Code');
  });

  it('drops the title when it matches an exclusion pattern', () => {
    const reads = [read(T(11, 56), 'Google Chrome', { windowTitle: 'My Bank statement - Google Chrome' })];
    const input = tipInput(cand(), snap({ readsToday: reads, now: T(11, 57) }), ['bank']);
    expect(input.title).toBeNull();
    expect(input.app).toBe('Google Chrome');
  });

  it('drops the title for a private-browsing window even without a matching exclusion pattern', () => {
    const reads = [read(T(11, 56), 'Google Chrome', { windowTitle: 'Secret tab - [InPrivate] - Google Chrome' })];
    const input = tipInput(cand(), snap({ readsToday: reads, now: T(11, 57) }), []);
    expect(input.title).toBeNull();
  });

  it("computes episode minutes and avgStuck from the app's own reads in the last 30 min", () => {
    const now = T(12, 0);
    const reads = [
      read(now - 35 * 60_000, 'Code', { stuck: 1 }),  // outside the 30-min window: excluded
      read(now - 20 * 60_000, 'Code', { stuck: 2 }),
      read(now - 10 * 60_000, 'Code', { stuck: 1.5 })
    ];
    const input = tipInput(cand(), snap({ readsToday: reads, now }), []);
    expect(input.episode.minutes).toBe(1); // 2 reads * 30s = 1 min
    expect(input.episode.avgStuck).toBeCloseTo(1.75);
  });

  it('carries the template through unchanged', () => {
    const input = tipInput(cand(), snap({ readsToday: [read(T(11), 'Code')], now: T(11) }), []);
    expect(input.template).toEqual({ title: 'Stuck in Code?', body: 'Looks like you have been stuck. Try a 5-min walk.' });
    expect(input.ruleId).toBe('stuck_tip');
  });

  it('drops the title when it contains an email address', () => {
    const reads = [read(T(11, 56), 'Outlook', { windowTitle: 'RE: budget - someone@example.com - Outlook' })];
    const input = tipInput(cand(), snap({ readsToday: reads, now: T(11, 57) }), []);
    expect(input.title).toBeNull();
  });

  it("prefers the read matching the current session's app over a more recent read from a different app", () => {
    const reads = [
      read(T(11, 40), 'Code', { windowTitle: 'main.ts - Code' }),
      read(T(11, 55), 'Google Chrome', { windowTitle: 'Inbox - Gmail - Google Chrome' })
    ];
    const sessions = [sess('Code', T(11, 30))];
    const input = tipInput(cand(), snap({ readsToday: reads, sessions, now: T(11, 57) }), []);
    expect(input.app).toBe('Code');
    expect(input.title).toBe('main.ts - Code');
  });

  it('falls back to the latest read overall when none match the current session app', () => {
    const reads = [read(T(11, 55), 'Google Chrome', { windowTitle: 'Inbox - Gmail - Google Chrome' })];
    const sessions = [sess('Slack', T(11, 50))]; // no Slack reads at all
    const input = tipInput(cand(), snap({ readsToday: reads, sessions, now: T(11, 57) }), []);
    expect(input.app).toBe('Google Chrome');
  });

  it("only counts a consecutive run of the app's own reads: a read of another app in between breaks it", () => {
    const now = T(12, 0);
    const reads = [
      read(now - 20 * 60_000, 'Code', { stuck: 1 }),
      read(now - 15 * 60_000, 'Google Chrome', { stuck: 0 }), // interleaved: breaks the run
      read(now - 10 * 60_000, 'Code', { stuck: 2 }),
      read(now - 5 * 60_000, 'Code', { stuck: 1.5 })
    ];
    const input = tipInput(cand(), snap({ readsToday: reads, now }), []);
    expect(input.app).toBe('Code'); // latest read overall (no sessions given)
    expect(input.episode.minutes).toBe(1); // only the last 2 Code reads count: the run breaks at Chrome
    expect(input.episode.avgStuck).toBeCloseTo(1.75);
  });
});

describe('tipRewriteAllowed', () => {
  const base = { mode: 'cloud' as const, installed: false, hasKey: true, unavailable: null, reportRunning: false, labelling: false, tipWriting: false, freeBytes: 10, needBytes: 5 };
  it('requires the writer to be usable, matching canWrite: cloud needs a key, local needs the model installed and available', () => {
    expect(tipRewriteAllowed(base)).toBe(true);
    expect(tipRewriteAllowed({ ...base, hasKey: false })).toBe(false);
    expect(tipRewriteAllowed({ ...base, mode: 'local', installed: true, unavailable: null })).toBe(true);
    expect(tipRewriteAllowed({ ...base, mode: 'local', installed: false })).toBe(false);
    expect(tipRewriteAllowed({ ...base, mode: 'local', installed: true, unavailable: 'crashes' })).toBe(false);
  });
  it('never allows a rewrite while a report/week job, a labelling batch, or another tip write is in flight', () => {
    expect(tipRewriteAllowed({ ...base, reportRunning: true })).toBe(false);
    expect(tipRewriteAllowed({ ...base, labelling: true })).toBe(false);
    expect(tipRewriteAllowed({ ...base, tipWriting: true })).toBe(false);
  });
  it('requires enough free memory in local mode only', () => {
    expect(tipRewriteAllowed({ ...base, mode: 'local', installed: true, freeBytes: 1, needBytes: 5 })).toBe(false);
    expect(tipRewriteAllowed({ ...base, freeBytes: 1, needBytes: 5 })).toBe(true); // cloud mode: memory irrelevant
  });
});

describe('tipAllowedMinutes', () => {
  it('includes the episode minutes and any number already in the template', () => {
    const input: TipInput = {
      ruleId: 'stuck_tip', app: 'Code', title: null,
      episode: { minutes: 12, category: 'work', activity: null, avgStuck: 1.8 },
      template: { title: 'Stuck for 3 times', body: 'Try a 5-min walk.' }
    };
    expect(tipAllowedMinutes(input)).toEqual(expect.arrayContaining([12, 3, 5]));
  });
});

describe('parseTip', () => {
  it('cuts title to 60 and body to 180 chars', () => {
    const r = parseTip({ title: 'T'.repeat(80), body: 'B'.repeat(220) });
    expect(r?.title.length).toBe(60);
    expect(r?.body.length).toBe(180);
  });

  it('rejects empty or missing title/body', () => {
    expect(parseTip({ title: '', body: 'ok' })).toBeNull();
    expect(parseTip({ title: 'ok', body: '' })).toBeNull();
    expect(parseTip('nope')).toBeNull();
    expect(parseTip(null)).toBeNull();
  });

  it('rewrites "I"/"my" to "you"/"your"', () => {
    const r = parseTip({ title: 'My focus tip', body: 'I think you should take a break from my project.' });
    expect(r?.title).toBe('Your focus tip');
    expect(r?.body).toContain('you should take a break from your project');
  });
});

describe('tipPrompt', () => {
  it('includes the template and asks for one short, practical, kind suggestion in second person', () => {
    const input: TipInput = {
      ruleId: 'stuck_tip', app: 'Code', title: 'main.ts - Code',
      episode: { minutes: 12, category: 'work', activity: null, avgStuck: 1.8 },
      template: { title: 'Stuck in Code?', body: 'Looks like you have been stuck for a while.' }
    };
    const { system, user } = tipPrompt(input);
    expect(system.toLowerCase()).toContain('second person');
    expect(system.toLowerCase()).toContain('practical');
    expect(system.toLowerCase()).toContain('kind');
    expect(user).toContain('Stuck in Code?');
    expect(user).toContain('main.ts - Code');
  });
});
