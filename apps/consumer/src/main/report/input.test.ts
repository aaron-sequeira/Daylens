import { describe, it, expect } from 'vitest';
import { allowedMinutes, buildReportInput, buildStats, buildWeek, compactDetail, forCloud, INPUT_CHARS, INPUT_EPISODES, reportPrompt } from './input';
import { buildCandidates } from './candidates';
import type { Episode } from './episodes';
import type { TodayView } from '../day/today';

const view = { date: '2026-09-26', now: 0, screenSec: 6 * 3600, activeSec: 5 * 3600, goalSec: 7 * 3600, firstSeenAt: 0,
  cards: [{ category: 'work', seconds: 4 * 3600, apps: [] }, { category: 'social', seconds: 3600, apps: [] }], timeline: [],
  health: { score: 80, breaks: 3, expectedBreaks: 6, longestStretchSec: 5400, lateNight: false },
  week: [0, 1, 2, 3, 4, 5].map((i) => ({ date: `d${i}`, seconds: i === 5 ? 6 * 3600 : 4 * 3600, byCategory: {} })).concat([{ date: '2026-09-26', seconds: 6 * 3600, byCategory: {} }]),
  apps: Array.from({ length: 8 }, (_, i) => ({ appName: `app${i}`, seconds: 1000 - i }))
} as unknown as TodayView;
const ep = (i: number, minutes: number): Episode => ({ id: `e${i}`, start: new Date(2026, 8, 26, 9, i).getTime(), end: new Date(2026, 8, 26, 9, i).getTime() + minutes * 60_000,
  app: 'Code', category: 'work', activity: 'coding', titles: ['t'], samples: ['s'], avgStuck: 0.25, avgDistraction: 0.1, stuckReads: 0, reads: 5 });

describe('report input', () => {
  it('builds stats from the day view (numbers never from the model)', () => {
    const s = buildStats(view, [ep(1, 30)], 42);
    expect(s).toMatchObject({ date: '2026-09-26', screenSec: 21600, deepWorkSec: 1800, switches: 42, health: { score: 80 } });
    expect(s.topApps).toHaveLength(5);
    expect(s.weekAvgSec).toBe((5 * 4 * 3600 + 6 * 3600) / 6); // the 6 days before, excluding the report date
  });
  it('clamps active time to screen time (the tracker can log more active samples than open screen time)', () => {
    const over = { ...view, screenSec: 3600, activeSec: 7200 } as unknown as TodayView;
    const s = buildStats(over, [], 0);
    expect(s.activeSec).toBe(3600);
  });
  it('passes the 40 longest episodes in time order, compacted', () => {
    const eps = Array.from({ length: 50 }, (_, i) => ep(i, i + 1));
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(input.episodes).toHaveLength(INPUT_EPISODES);
    expect(input.episodes[0]).toMatchObject({ id: 'e10', start: '09:10', minutes: 11, stuck: 0.3, distraction: 0.1, titles: ['t'] });
  });
  it('keeps a busy day under the hard input cap, with capped candidates and the most stuck episode\'s samples', () => {
    const text = (i: number, k: number, n: number): string => `${i}-${k} `.padEnd(n, 'abcdefghij ');
    // 60 episodes; every third one (20 in all) is stuck, each more stuck than the last.
    const eps = Array.from({ length: 60 }, (_, i): Episode => ({ ...ep(i, i % 3 === 0 ? 30 : 5 + ((i * 7) % 50)),
      titles: [0, 1, 2].map((k) => `${text(i, k, 180)} - Visual Studio Code`), samples: [0, 1, 2].map((k) => text(i, k, 300)),
      ...(i % 3 === 0 ? { avgStuck: 1.5 + i / 100, stuckReads: 4 } : { avgStuck: 0.2, stuckReads: 0 }) }));
    const candidates = buildCandidates({ episodes: eps,
      searches: Array.from({ length: 6 }, (_, n) => ({ query: `how to fix the vite build error number ${n} in electron main process`, count: 4 })),
      nudges: Array.from({ length: 6 }, (_, n) => ({ id: n, ruleId: 'doomscroll', title: "You've been scrolling Reddit for 20 minutes", status: 'dismissed' })),
      caps: ['YouTube', 'Discord', 'Reddit', 'X', 'Twitch'].map((app) => ({ app, minutes: 30, usedMin: 75, usedMs: 75 * 60_000 })) });
    const input = buildReportInput({ stats: buildStats(view, eps, 310), episodes: eps, candidates, goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });

    expect(reportPrompt(input).user.length).toBeLessThanOrEqual(INPUT_CHARS);
    expect(INPUT_CHARS).toBe(10_500);
    const kinds = input.candidates.map((c) => c.kind);
    expect(['stuck', 'search', 'nudge', 'cap'].map((k) => kinds.filter((x) => x === k).length)).toEqual([5, 3, 3, 3]);
    for (const c of input.candidates) expect(c.text.length).toBeLessThanOrEqual(130); // the embedded title is cut to 80
    expect(input.episodes.find((x) => x.id === 'e57')).toBeDefined(); // the most stuck episode stays
    // Episode samples give way first, but candidates (with their samples) are never cut.
    expect(input.candidates.filter((c) => c.kind === 'stuck').every((c) => c.sample)).toBe(true);
    expect(input.episodes.length).toBeGreaterThan(20);
    expect(input.episodes.every((e) => !('end' in e))).toBe(true);
    // Samples within budget, a candidate's sample counted once when its episode also carries it.
    const kept = new Map(input.episodes.map((e) => [e.id, e.samples]));
    const sampleChars = input.episodes.reduce((a, e) => a + e.samples.join('').length, 0) + input.candidates.reduce((a, c) =>
      a + (c.sample && !kept.get(c.id.replace('stuck:', ''))?.some((s) => s.startsWith(c.sample!)) ? c.sample.length : 0), 0);
    expect(sampleChars).toBeLessThanOrEqual(2500);
    for (const e of input.episodes) for (const t of e.titles) expect(t.length).toBeLessThanOrEqual(80);
  });
  it('counts a stuck candidate\'s sample once when its episode carries the same text', () => {
    // 5 stuck episodes (e4 most stuck), 3 × 300-char samples each; their candidates carry the first 200 chars.
    const eps = Array.from({ length: 5 }, (_, i): Episode => ({ ...ep(i, 30), avgStuck: 2 + i, stuckReads: 4, samples: [0, 1, 2].map((k) => `${i}-${k} `.padEnd(300, 'x')) }));
    const candidates = buildCandidates({ episodes: eps, searches: [], nudges: [], caps: [] }); // 5 × 200 = 1000 chars
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates, goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const samples = (id: string) => input.episodes.find((e) => e.id === id)!.samples.length;
    // 1000 + e4 (100 + 300 + 300) + e3 (700) + e2's first sample (100) = 2500. Counting twice, e2 would get nothing.
    expect([samples('e4'), samples('e3'), samples('e2'), samples('e1')]).toEqual([3, 3, 1, 0]);
    expect(input.candidates.every((c) => c.sample?.length === 200)).toBe(true);
  });
  it('never exceeds the cap: drops the shortest episodes, then candidates, when trimming text is not enough', () => {
    const eps = Array.from({ length: 40 }, (_, i): Episode => ({ ...ep(i, i + 1), app: `${'C:\\Program Files\\Very Long Vendor Name\\'.repeat(6)}app${i}.exe` }));
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(INPUT_CHARS);
    expect(input.episodes.length).toBeLessThan(40);
    const shortestKept = Math.min(...input.episodes.map((e) => e.minutes));
    expect(input.episodes).toHaveLength(40 - shortestKept + 1); // exactly the shortest ones went
    const huge = [0, 1, 2].map((n) => ({ id: `search:${n}`, kind: 'search' as const, text: `Searched "${'q'.repeat(5000)}" 3 times` }));
    const input2 = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: huge, goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(JSON.stringify(input2).length).toBeLessThanOrEqual(INPUT_CHARS);
    expect(input2.candidates.map((c) => c.id)).toEqual(['search:0']);
  });
  it('drops episode samples first, then titles (least stuck first), before dropping any episode', () => {
    const eps = Array.from({ length: 40 }, (_, i): Episode => ({ ...ep(i, 40 - i), app: `C:\\Program Files\\Vendor\\${'A'.repeat(50)}\\app${i}.exe`,
      titles: ['x'.repeat(80)], samples: [`${i} `.padEnd(300, 's')], ...(i === 39 ? { avgStuck: 3, stuckReads: 5 } : {}) }));
    const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(INPUT_CHARS);
    expect(input.episodes).toHaveLength(40);
    expect(input.episodes.every((e) => e.samples.length === 0)).toBe(true);
    const withTitles = input.episodes.filter((e) => e.titles.length).map((e) => e.id);
    expect(withTitles.length).toBeLessThan(40); // titles went too
    expect(withTitles.length).toBeGreaterThan(0);
    expect(withTitles).toContain('e39'); // the stuck one (also the shortest) is the last to lose its title
  });
  it('compacts the day detail for the writer: fewer items, 2 pages per site, titles cut to 60', () => {
    const long = (p: string, i: number) => `${p}${i} `.padEnd(100, 'x');
    const detail = {
      apps: Array.from({ length: 10 }, (_, i) => ({ app: `App${i}`, min: 60 - i })),
      sites: Array.from({ length: 10 }, (_, i) => ({ site: `Site${i}`, min: 50 - i, pages: [0, 1, 2].map((k) => long(`p${k}-`, i)) })),
      videos: Array.from({ length: 10 }, (_, i) => ({ title: long('v', i), site: 'YouTube', min: 40 - i })),
      games: Array.from({ length: 8 }, (_, i) => ({ name: `Game${i}`, min: 30 - i })),
      learning: Array.from({ length: 8 }, (_, i) => ({ title: long('l', i), where: 'MDN Web Docs', min: 20 - i }))
    };
    const c = compactDetail(detail);
    expect([c.apps.length, c.sites.length, c.videos.length, c.games.length, c.learning.length]).toEqual([8, 8, 6, 5, 5]);
    expect(c.sites.every((s) => s.pages.length === 2 && s.pages.every((p) => p.length <= 60))).toBe(true);
    expect([...c.videos.map((v) => v.title), ...c.learning.map((l) => l.title)].every((t) => t.length <= 60)).toBe(true);
    expect(c.apps[0]).toEqual({ app: 'App0', min: 60 });
    expect(detail.sites[0].pages).toHaveLength(3); // not mutated
  });
  it('builds the 7-day memory: screen minutes, top 3 apps and sites, a stored headline, and the average', () => {
    const d = (apps: string[], sites: string[]) => ({ apps: apps.map((app) => ({ app, min: 10 })), sites: sites.map((site) => ({ site, min: 5, pages: ['x'] })), videos: [], games: [], learning: [] });
    const week = buildWeek([
      { date: '2026-09-25', screenSec: 6 * 3600, detail: d(['Code', 'Chrome', 'Slack', 'Spotify'], ['GitHub', 'YouTube', 'Reddit', 'X']), headline: 'A focused Friday' },
      { date: '2026-09-24', screenSec: 0, detail: d([], []) },
      { date: '2026-09-23', screenSec: 2 * 3600 + 29, detail: d(['Code'], []) }
    ]);
    expect(week.days).toEqual([
      { date: '2026-09-25', screenMin: 360, topApps: ['Code', 'Chrome', 'Slack'], topSites: ['GitHub', 'YouTube', 'Reddit'], headline: 'A focused Friday' },
      { date: '2026-09-23', screenMin: 120, topApps: ['Code'], topSites: [] }
    ]);
    expect(week.avgScreenMin).toBe(240); // over the days with screen time
    expect(buildWeek([]).avgScreenMin).toBe(0);
  });
  it('allows detail and week minute values in the numeric grounding guard', () => {
    const detail = { apps: [{ app: 'Code', min: 91 }], sites: [{ site: 'GitHub', min: 17, pages: [] }], videos: [{ title: 'v', site: 'YouTube', min: 23 }],
      games: [{ name: 'Hades', min: 44 }], learning: [{ title: 'l', where: 'MDN Web Docs', min: 13 }] };
    const week = { days: [{ date: '2026-09-25', screenMin: 333, topApps: [], topSites: [] }], avgScreenMin: 287 };
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 }, detail, week });
    expect(allowedMinutes(input)).toEqual(expect.arrayContaining([91, 17, 23, 44, 13, 333, 287]));
  });
  it('tells the writer to use detail for specifics and week for trends, never inventing items', () => {
    const { system } = reportPrompt(buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } }));
    expect(system).toContain('Use detail to be specific about what the person did (apps, sites, videos, games, learning).');
    expect(system).toContain('Use week to notice trends and changes versus recent days');
    expect(system).toContain('Never invent items not in detail/episodes.');
  });

  // A heavy day: 60 episodes with titles and samples, capped candidates, full detail with long titles, 7 days of memory.
  const heavyDetail = (n = 100) => {
    const long = (p: string, i: number) => `${p}${i} `.padEnd(n, 'abcdefghij ');
    return {
      apps: Array.from({ length: 10 }, (_, i) => ({ app: long('Application ', i).slice(0, 40), min: 200 - i })),
      sites: Array.from({ length: 10 }, (_, i) => ({ site: long('Website ', i).slice(0, 30), min: 150 - i, pages: [0, 1, 2].map((k) => long(`page ${k} `, i)) })),
      videos: Array.from({ length: 10 }, (_, i) => ({ title: long('video ', i), site: 'YouTube', min: 90 - i })),
      games: Array.from({ length: 8 }, (_, i) => ({ name: long('Game ', i).slice(0, 40), min: 70 - i })),
      learning: Array.from({ length: 8 }, (_, i) => ({ title: long('lesson ', i), where: 'MDN Web Docs', min: 60 - i }))
    };
  };
  const heavyWeek = () => buildWeek(Array.from({ length: 7 }, (_, i) => ({
    date: `2026-09-${String(25 - i).padStart(2, '0')}`, screenSec: (300 + i * 7) * 60, detail: heavyDetail(), headline: `A long headline for day ${i} `.padEnd(80, 'h')
  })));
  const heavyEpisodes = () => {
    const text = (i: number, k: number, n: number): string => `${i}-${k} `.padEnd(n, 'abcdefghij ');
    return Array.from({ length: 60 }, (_, i): Episode => ({ ...ep(i, i % 3 === 0 ? 30 : 5 + ((i * 7) % 50)),
      titles: [0, 1, 2].map((k) => `${text(i, k, 180)} - Visual Studio Code`), samples: [0, 1, 2].map((k) => text(i, k, 300)),
      ...(i % 3 === 0 ? { avgStuck: 1.5 + i / 100, stuckReads: 4 } : { avgStuck: 0.2, stuckReads: 0 }) }));
  };
  const heavyCandidates = (eps: Episode[]) => buildCandidates({ episodes: eps,
    searches: Array.from({ length: 6 }, (_, n) => ({ query: `how to fix the vite build error number ${n} in electron main process`, count: 4 })),
    nudges: Array.from({ length: 6 }, (_, n) => ({ id: n, ruleId: 'doomscroll', title: "You've been scrolling Reddit for 20 minutes", status: 'dismissed' })),
    caps: ['YouTube', 'Discord', 'Reddit', 'X', 'Twitch'].map((app) => ({ app, minutes: 30, usedMin: 75, usedMs: 75 * 60_000 })) });

  it('keeps a heavy day with full detail and a 7-day memory within the hard cap, never cutting facts, candidates or goals', () => {
    const eps = heavyEpisodes();
    const candidates = heavyCandidates(eps);
    const goals = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };
    const input = buildReportInput({ stats: buildStats(view, eps, 310), episodes: eps, candidates, goals, detail: heavyDetail(), week: heavyWeek() });
    expect(reportPrompt(input).user.length).toBeLessThanOrEqual(INPUT_CHARS);
    expect(input.candidates.map((c) => c.id)).toEqual(candidates.map((c) => c.id));
    expect(input.goals).toEqual(goals);
    expect(input.facts.screenMin).toBe(360);
    expect(input.detail.apps).toHaveLength(8);
    expect(input.week.days).toHaveLength(7);
    // Today's episodes outlive the week text: headlines and topSites went first (7 episodes survived when they didn't).
    expect(input.week.days.every((d) => !d.headline && d.topSites.length === 0)).toBe(true);
    expect(input.week.days.every((d) => d.topApps.length === 3)).toBe(true);
    expect(input.episodes.length).toBeGreaterThanOrEqual(14); // 16 today; 7 under the old order
  });
  it('gives way in order: episode samples, titles, week headlines, week topSites, episodes, then detail pages', () => {
    const goals = { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 };
    const seen = { episodesGone: false, headlinesGone: false, topSitesGone: false, pagesGone: false };
    for (let pad = 0; pad <= 6000; pad += 250) {
      const eps = heavyEpisodes().slice(0, 12);
      // Uncapped candidate text squeezes the budget (candidates are never cut, so everything else must give way).
      const candidates = Array.from({ length: 4 }, (_, n) => ({ id: `search:${n}`, kind: 'search' as const, text: 'q'.repeat(pad / 4) }));
      const input = buildReportInput({ stats: buildStats(view, eps, 0), episodes: eps, candidates, goals, detail: heavyDetail(), week: heavyWeek() });
      expect(JSON.stringify(input).length).toBeLessThanOrEqual(INPUT_CHARS);
      expect(input.candidates).toHaveLength(4);
      const anySamples = input.episodes.some((e) => e.samples.length > 0);
      const allTitles = input.episodes.every((e) => e.titles.length === 3);
      const headlines = input.week.days.filter((d) => d.headline).length;
      const topSites = input.week.days.filter((d) => d.topSites.length).length;
      const pages = input.detail.sites.filter((s) => s.pages.length).length;
      const anyTitles = input.episodes.some((e) => e.titles.length > 0);
      if (anySamples) expect(allTitles).toBe(true);
      if (anyTitles) expect(headlines).toBe(7); // titles go before any week text
      if (headlines) expect(topSites).toBe(7);
      if (topSites) expect(input.episodes).toHaveLength(12); // week text goes before any episode
      if (input.episodes.length) expect(pages).toBe(8);
      seen.episodesGone ||= input.episodes.length === 0;
      seen.headlinesGone ||= headlines === 0;
      seen.topSitesGone ||= topSites === 0;
      seen.pagesGone ||= pages < 8;
    }
    expect(seen).toEqual({ episodesGone: true, headlinesGone: true, topSitesGone: true, pagesGone: true });
  });
  it('keeps detail titles for the cloud but strips samples', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [ep(1, 30)], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 },
      candidates: [], detail: { apps: [], sites: [{ site: 'GitHub', min: 5, pages: ['Repo'] }], videos: [{ title: 'Lofi', site: 'YouTube', min: 9 }], games: [], learning: [] } });
    const c = forCloud(input);
    expect(c.detail.sites[0].pages).toEqual(['Repo']);
    expect(c.detail.videos[0].title).toBe('Lofi');
    expect(c.episodes[0].samples).toEqual([]);
  });
  it('builds a prompt that names candidate ids and forbids invented numbers', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [{ id: 'stuck:e1', kind: 'stuck', text: 'Stuck' }], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const p = reportPrompt(input);
    expect(p.system).toMatch(/candidateId/);
    expect(p.system).toMatch(/do not invent/i);
    expect(p.user).toContain('"stuck:e1"');
  });
  it('carries a human-readable facts object for the writer, in minutes, active capped at screen time', () => {
    const stats = { ...buildStats(view, [ep(1, 30)], 42), activeSec: 999999 }; // pretend the tracker over-counted
    const input = buildReportInput({ stats, episodes: [ep(1, 30)], candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    expect(input.facts).toMatchObject({
      screenMin: 360, activeMin: 360, deepWorkMin: 30, breaks: 3, expectedBreaks: 6, lateNight: false, goalMin: 420, switches: 42
    });
    expect(input.facts.topApps[0]).toMatchObject({ app: 'app0' });
    expect((input as any).stats).toBeUndefined(); // the raw seconds/health blob no longer rides along
  });
  it('collects allowed minute values from facts, episode minutes and numbers in candidate text', () => {
    const eps = [ep(1, 30), ep(2, 10)];
    const candidates = [{ id: 'cap:YouTube', kind: 'cap' as const, text: 'YouTube: 75 min used, limit 30 min' }];
    const input = buildReportInput({ stats: buildStats(view, eps, 42), episodes: eps, candidates, goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const allowed = allowedMinutes(input);
    expect(allowed).toEqual(expect.arrayContaining([360, 30, 10, 75, 420]));
  });
  it('builds a system prompt that demands second-person voice and grounded facts, with a numberless example', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [], candidates: [], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 } });
    const { system } = reportPrompt(input);
    expect(system).toMatch(/never use ['"]?i['"]?, ['"]?me['"]?, ['"]?my['"]? or ['"]?we['"]?/i);
    expect(system).toMatch(/habits.*(?:to improve|never praise)/i);
    expect(system).toMatch(/wins.*genuine positives.*facts/i);
    expect(system).toMatch(/deepWorkMin is 0/);
    const exampleMatch = system.match(/\{[^{}]*"headline"[^{}]*\}/);
    expect(exampleMatch).not.toBeNull();
    expect(exampleMatch![0]).not.toMatch(/\d/);
  });
  it('strips every screen-text sample for the cloud, leaving the rest intact', () => {
    const input = buildReportInput({ stats: buildStats(view, [], 0), episodes: [ep(1, 30)], goals: { dailyGoalMin: 420, windDownTime: '23:00', breakIntervalMin: 50 },
      candidates: [{ id: 'stuck:e1', kind: 'stuck', text: 'Stuck', sample: 'TypeError: secret' }] });
    const c = forCloud(input);
    expect(c.episodes[0].samples).toEqual([]);
    expect(c.candidates[0]).toEqual({ id: 'stuck:e1', kind: 'stuck', text: 'Stuck' });
    expect(c.episodes[0].titles).toEqual(['t']);
    expect(reportPrompt(c).user).not.toMatch(/secret|"s"\]/);
    expect(input.episodes[0].samples).toEqual(['s']); // the original is not mutated
    expect(input.candidates[0].sample).toBe('TypeError: secret');
  });
});
