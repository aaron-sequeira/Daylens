import { describe, it, expect } from 'vitest';
import { MIN, emptyView, read, sess, snap, T } from '../fixtures';
import { appCap, doomscroll, scattered, stuckEscape } from './behaviour';

const scroll = (from: number, minutes: number, app = 'Google Chrome', title: string | null = 'Reddit') =>
  Array.from({ length: Math.floor(minutes / 2) + 1 }, (_, i) => read(from + i * 2 * MIN, app, { distraction: 1.8, windowTitle: title }));

describe('doomscroll', () => {
  const inChrome = [sess('Google Chrome', T(11))];
  it('fires after 20 min of high-distraction reads in one app', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 22), sessions: inChrome, now: T(11, 53) });
    expect(doomscroll(s)).toMatchObject({ ruleId: 'doomscroll', kind: 'behaviour', key: `doomscroll:Google Chrome:${T(11, 30)}` });
  });
  it('uses 15 min for a distraction-list app/site', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 16, 'Google Chrome', 'YouTube - Google Chrome'), sessions: inChrome, now: T(11, 47), profile: { ...snap().profile, distractions: ['YouTube'] } });
    expect(doomscroll(s)?.title).toMatch(/YouTube/);
  });
  it('stays silent without labels or with stale reads', () => {
    expect(doomscroll(snap({ readsToday: [], sessions: inChrome }))).toBeNull();
    expect(doomscroll(snap({ readsToday: scroll(T(10), 22), sessions: inChrome, now: T(11, 53) }))).toBeNull();
  });
  it('still fires when the labels arrive 20 min late, while the user is still in that app', () => {
    // reads 11:00–11:22, labelled ~20 min later; the app match ignores case and the .exe suffix
    const s = snap({ readsToday: scroll(T(11), 22, 'Chrome.exe'), sessions: [sess('Code', T(10)), sess('chrome', T(11))], now: T(11, 42) });
    expect(doomscroll(s)).toMatchObject({ ruleId: 'doomscroll' });
  });
  it('stays silent once the user has moved to another app', () => {
    const s = snap({ readsToday: scroll(T(11), 22), sessions: [sess('Google Chrome', T(11)), sess('Code', T(11, 30))], now: T(11, 42) });
    expect(doomscroll(s)).toBeNull();
  });
});

describe('scattered', () => {
  it('fires at 40 switches in 15 minutes', () => {
    const sessions = Array.from({ length: 41 }, (_, i) => sess(i % 2 ? 'A' : 'B', T(11, 45) + i * 20_000));
    expect(scattered(snap({ sessions, now: T(12) }))).toMatchObject({ ruleId: 'scattered' });
    expect(scattered(snap({ sessions: sessions.slice(0, 30), now: T(12) }))).toBeNull();
  });
  it('ignores title-only changes inside one app', () => {
    const sessions = Array.from({ length: 41 }, (_, i) => sess('Google Chrome', T(11, 45) + i * 20_000, null, `tab ${i}`));
    expect(scattered(snap({ sessions, now: T(12) }))).toBeNull();
  });
});

describe('stuck_escape', () => {
  it('fires after 3 stuck → social/entertainment jumps today', () => {
    const reads = [0, 60, 120].flatMap((m) => [
      read(T(9) + m * MIN, 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + m * MIN + MIN, 'Discord', { category: 'social', conf: 0.8 })
    ]);
    expect(stuckEscape(snap({ readsToday: reads }))).toMatchObject({ ruleId: 'stuck_escape', key: 'stuck_escape:2026-09-25' });
    expect(stuckEscape(snap({ readsToday: reads.slice(0, 4) }))).toBeNull();
  });
  it('with escapes to 2+ apps, names the most frequent', () => {
    const reads = [
      read(T(9), 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + MIN, 'Discord', { category: 'social', conf: 0.8 }),
      read(T(9) + 60 * MIN, 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + 61 * MIN, 'Instagram', { category: 'entertainment', conf: 0.8 }),
      read(T(9) + 120 * MIN, 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + 121 * MIN, 'Discord', { category: 'social', conf: 0.8 }),
      read(T(9) + 180 * MIN, 'Code', { stuck: 1.7, category: 'work', conf: 0.9 }),
      read(T(9) + 181 * MIN, 'Instagram', { category: 'entertainment', conf: 0.8 })
    ];
    const result = stuckEscape(snap({ readsToday: reads }));
    expect(result).toMatchObject({ ruleId: 'stuck_escape' });
    expect(result?.body).toContain('4 times');
    expect(result?.body).toContain('mostly');
  });
  it('ignores low-confidence categories', () => {
    const reads = [0, 60, 120].flatMap((m) => [read(T(9) + m * MIN, 'Code', { stuck: 1.7 }), read(T(9) + m * MIN + MIN, 'Discord', { category: 'social', conf: 0.3 })]);
    expect(stuckEscape(snap({ readsToday: reads }))).toBeNull();
  });
});

describe('app_cap', () => {
  it('fires when an app passes its daily limit, once per day per app', () => {
    const s = snap({ limits: [{ app: 'Discord', minutes: 30 }], view: emptyView({ apps: [{ appName: 'Discord.exe', seconds: 31 * 60 }] }) });
    expect(appCap(s)).toMatchObject({ ruleId: 'app_cap', key: 'app_cap:Discord:2026-09-25' });
    expect(appCap(snap({ limits: [{ app: 'Discord', minutes: 30 }], view: emptyView({ apps: [{ appName: 'Discord', seconds: 20 * 60 }] }) }))).toBeNull();
  });
});
