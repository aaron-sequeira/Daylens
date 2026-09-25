import { describe, it, expect } from 'vitest';
import { MIN, emptyView, read, sess, snap, T } from '../fixtures';
import { appCap, doomscroll, scattered, stuckEscape } from './behaviour';

const scroll = (from: number, minutes: number, app = 'Google Chrome', title: string | null = 'Reddit') =>
  Array.from({ length: Math.floor(minutes / 2) + 1 }, (_, i) => read(from + i * 2 * MIN, app, { distraction: 1.8, windowTitle: title }));

describe('doomscroll', () => {
  it('fires after 20 min of high-distraction reads in one app', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 22), now: T(11, 53) });
    expect(doomscroll(s)).toMatchObject({ ruleId: 'doomscroll', kind: 'behaviour', key: `doomscroll:Google Chrome:${T(11, 30)}` });
  });
  it('uses 15 min for a distraction-list app/site', () => {
    const s = snap({ readsToday: scroll(T(11, 30), 16, 'Google Chrome', 'YouTube - Google Chrome'), now: T(11, 47), profile: { ...snap().profile, distractions: ['YouTube'] } });
    expect(doomscroll(s)?.title).toMatch(/YouTube/);
  });
  it('stays silent without labels or with stale reads', () => {
    expect(doomscroll(snap({ readsToday: [] }))).toBeNull();
    expect(doomscroll(snap({ readsToday: scroll(T(10), 22), now: T(11, 53) }))).toBeNull();
  });
});

describe('scattered', () => {
  it('fires at 40 switches in 15 minutes', () => {
    const sessions = Array.from({ length: 41 }, (_, i) => sess(i % 2 ? 'A' : 'B', T(11, 45) + i * 20_000));
    expect(scattered(snap({ sessions, now: T(12) }))).toMatchObject({ ruleId: 'scattered' });
    expect(scattered(snap({ sessions: sessions.slice(0, 30), now: T(12) }))).toBeNull();
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
