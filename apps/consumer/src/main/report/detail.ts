import type { FocusSessionRow } from '@worksight/core/types';
import { sessionInterval } from '../day/time';
import { displayAppName } from '../../shared/categories';
import { isExcluded } from '../screen/exclusions';

/** "Your day in detail": computed in code from window titles and read labels, never by the AI. Screen text is never used. */
export interface DayDetail {
  apps: { app: string; min: number }[];
  sites: { site: string; min: number; pages: string[] }[];
  videos: { title: string; site: string; min: number }[];
  games: { name: string; min: number }[];
  learning: { title: string; where: string; min: number }[];
}
export interface DetailRead { at: number; appName: string; activity: string | null; category: string | null; }

const PAGE_CHARS = 80;
const SITE_CHARS = 80;
const NOT_SCREEN = /^lockapp(\.exe)?$/i; // Windows lock screen (as in day/today.ts)
const BROWSER = /^(google chrome|chrome|microsoft edge|msedge|mozilla firefox|firefox|brave|brave browser|opera|opera gx|vivaldi|arc)$/i;
const EDGE = /^(microsoft edge|msedge)$/i;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const BROWSER_SUFFIX = /\s+[-—–|]\s+(?:google chrome|microsoft\s*edge|mozilla firefox|firefox|brave|opera|vivaldi|arc)\s*$/i;
const PROFILE_SUFFIX = /\s+[-—–]\s+(?:personal|work|guest|default|profile \d+)\s*$/i;
const MORE_PAGES = /\s+and \d+ more pages?\s*$/i;
const COUNTER = /^\(\d+\+?\)\s*/;
const BLANK = /^(new tab|new private tab|start page|blank page|untitled)$/i;
const PRIVATE = /InPrivate|Incognito|Private Browsing|\(Private\)/i;
// Exported for coach/tip.ts, which drops the same titles from the tip-rewrite input.
export const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// The site is the last " - " / " | " / " — " / " – " / " · " segment (GitHub uses " · ").
const SPLIT = /^(.*)\s[-|—–·]\s(.+)$/;
const TAIL = /\s[-—–]\s([^-—–]+)$/;

const SITE_NAMES: Record<string, string> = Object.fromEntries([
  ['youtube', 'YouTube'], ['stack overflow', 'Stack Overflow'], ['stackoverflow', 'Stack Overflow'], ['github', 'GitHub'], ['gmail', 'Gmail'],
  ['reddit', 'Reddit'], ['x', 'X'], ['twitter', 'X'], ['mdn', 'MDN Web Docs'], ['mdn web docs', 'MDN Web Docs'], ['netflix', 'Netflix'],
  ['twitch', 'Twitch'], ['prime video', 'Prime Video'], ['amazon prime video', 'Prime Video'], ['disney+', 'Disney+'], ['disney plus', 'Disney+'],
  ['vimeo', 'Vimeo'], ['crunchyroll', 'Crunchyroll'], ['w3schools', 'W3Schools'], ['coursera', 'Coursera'], ['udemy', 'Udemy'],
  ['khan academy', 'Khan Academy'], ['freecodecamp', 'freeCodeCamp'], ['wikipedia', 'Wikipedia'], ['geeksforgeeks', 'GeeksforGeeks'],
  ['real python', 'Real Python'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['google search', 'Google Search'],
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude']
]);
const VIDEO_SITES = new Set(['YouTube', 'Netflix', 'Twitch', 'Prime Video', 'Disney+', 'Vimeo', 'Crunchyroll']);
const LEARNING_SITES = new Set(['MDN Web Docs', 'Stack Overflow', 'W3Schools', 'Coursera', 'Udemy', 'Khan Academy', 'freeCodeCamp', 'Wikipedia', 'GeeksforGeeks', 'Real Python']);
const DOCS_HOST = /^docs\.[a-z0-9-]+(\.[a-z0-9-]+)+$/i; // docs.python.org written as the site segment
// Writing tools are never "learning", whatever Laya labelled the screen.
const NOT_LEARNING = /^(google docs|google sheets|google slides|microsoft word|word|winword|microsoft office|office|microsoft 365|notion)$/i;
const LEARN_TITLE = /tutorial|course|lesson|learn|how to|explained|guide/i;
const KNOWN_GAMES = ['deadlock', 'valorant', 'leagueoflegends', 'minecraft', 'fortnite', 'cs2', 'dota2', 'overwatch', 'apexlegends', 'roblox', 'rocketleague', 'genshinimpact'];
const NOT_GAMES = /^(steam|steamwebhelper)$/i; // the Steam client (incl. Big Picture) isn't a game
const MIN_GAMING_READS = 5;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normSite = (raw: string): string => (SITE_NAMES[raw.toLowerCase()] ?? raw).slice(0, SITE_CHARS);
const withoutBrowser = (title: string): string => title.replace(ZERO_WIDTH, '').trim().replace(BROWSER_SUFFIX, '');
const withoutTail = (s: string, tail: string): string => s.replace(new RegExp(`\\s+[-—–]\\s+${escapeRe(tail)}\\s*$`), '');

/** A browser window title → site + page. Strips the browser name (incl. Edge's zero-width characters), profile names
 * (`profile` = a custom Edge profile name, see edgeProfile), "and N more pages", and a leading "(3) " counter. The site
 * is the last separator segment (a leading "GitHub - " also means GitHub), normalised when known, ≤ 80 chars; the page
 * is the rest (≤ 80 chars), or null when the title is just the site. No separator left and not a known site name →
 * null: the page title is never taken for a site. Blank tabs give null. */
export function parseBrowserTitle(title: string, profile?: string): { site: string; page: string | null } | null {
  let rest = withoutBrowser(title).replace(PROFILE_SUFFIX, '');
  if (profile) rest = withoutTail(rest, profile);
  rest = rest.replace(MORE_PAGES, '').replace(COUNTER, '').trim();
  if (!rest || BLANK.test(rest)) return null;
  const gh = rest.match(/^GitHub\s[-—–]\s(.+)$/i);
  if (gh) return { site: 'GitHub', page: gh[1].trim().slice(0, PAGE_CHARS) };
  const m = rest.match(/^(.*)\s\/\s(X|Twitter)$/i) ?? rest.match(SPLIT);
  if (!m) { const known = SITE_NAMES[rest.toLowerCase()]; return known ? { site: known, page: null } : null; }
  const site = normSite(m[2].trim());
  const page = m[1].trim().slice(0, PAGE_CHARS);
  return { site, page: page && page.toLowerCase() !== site.toLowerCase() ? page : null };
}

/** A custom Edge profile name: the same trailing segment on every (non-private) Edge title that day. Not a known site
 * (a day of only YouTube in Edge shares "YouTube"), and stripping it must leave a separator in at least one title. */
function edgeProfile(sessions: FocusSessionRow[]): string | undefined {
  const tails = new Set<string>(), rests = new Set<string>();
  for (const s of sessions) {
    if (!EDGE.test(displayAppName(s.appName)) || !s.windowTitle || PRIVATE.test(s.windowTitle)) continue;
    const rest = withoutBrowser(s.windowTitle);
    const m = rest.match(TAIL);
    if (!m) return undefined;
    tails.add(m[1].trim());
    rests.add(rest);
  }
  const [tail] = tails;
  if (tails.size !== 1 || rests.size < 2 || SITE_NAMES[tail.toLowerCase()]) return undefined;
  return [...rests].some((r) => SPLIT.test(withoutTail(r, tail))) ? tail : undefined;
}

const isGame = (app: string, gaming: Set<string>): boolean => {
  if (NOT_GAMES.test(app) || BROWSER.test(app)) return false;
  const n = app.toLowerCase().replace(/[^a-z0-9]/g, '');
  return KNOWN_GAMES.some((g) => n.startsWith(g)) || gaming.has(app.toLowerCase());
};

function add<T extends { ms: number }>(m: Map<string, T>, key: string, ms: number, init: () => Omit<T, 'ms'>): T {
  const e = m.get(key) ?? ({ ...init(), ms: 0 } as T);
  e.ms += ms;
  m.set(key, e);
  return e;
}
/** Biggest first, rounded to minutes, entries under 1 min dropped, capped at `n`. */
const top = <T extends { ms: number }>(m: Map<string, T>, n: number): (T & { min: number })[] =>
  [...m.values()].sort((a, b) => b.ms - a.ms).map((e) => ({ ...e, min: Math.round(e.ms / 60_000) })).filter((e) => e.min >= 1).slice(0, n);

/** Reads of one app, sorted by time, in [start, end] (binary search for the start). */
function readsIn(sorted: DetailRead[], start: number, end: number): DetailRead[] {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].at < start) lo = mid + 1; else hi = mid; }
  const out: DetailRead[] = [];
  for (let k = lo; k < sorted.length && sorted[k].at <= end; k++) out.push(sorted[k]);
  return out;
}

export function buildDayDetail(i: { sessions: FocusSessionRow[]; reads: DetailRead[]; now: number; exclusions: string[] }): DayDetail {
  const sorted = [...i.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const latest = sorted[sorted.length - 1];
  const readsOf = new Map<string, DetailRead[]>();
  for (const r of i.reads) {
    const k = displayAppName(r.appName).toLowerCase();
    const list = readsOf.get(k);
    if (list) list.push(r); else readsOf.set(k, [r]);
  }
  for (const list of readsOf.values()) list.sort((a, b) => a.at - b.at);
  const gaming = new Set([...readsOf].filter(([k, rs]) => !BROWSER.test(k) && rs.length >= MIN_GAMING_READS
    && rs.filter((r) => r.activity === 'gaming').length * 2 >= rs.length).map(([k]) => k));
  const profile = edgeProfile(sorted);

  const apps = new Map<string, { app: string; ms: number }>();
  const sites = new Map<string, { site: string; ms: number; pages: Map<string, number> }>();
  const videos = new Map<string, { title: string; site: string; ms: number }>();
  const games = new Map<string, { name: string; ms: number }>();
  const learning = new Map<string, { title: string; where: string; ms: number }>();
  const learn = (title: string, where: string, ms: number): void => { add(learning, `${where}\u0000${title}`, ms, () => ({ title, where })); };

  for (const s of sorted) {
    if (NOT_SCREEN.test(s.appName.trim())) continue;
    const iv = sessionInterval(s, s === latest, i.now);
    const ms = iv.end - iv.start;
    if (ms <= 0) continue;
    const app = displayAppName(s.appName);
    add(apps, app, ms, () => ({ app }));
    if (isGame(app, gaming)) add(games, app, ms, () => ({ name: app }));

    const title = s.windowTitle?.trim() || null;
    // Private windows and excluded titles give no site, page, video or learning entry (the app's time still counts).
    if (!title || PRIVATE.test(title) || isExcluded(i.exclusions, s.appName, title)) continue;
    const hasEmail = EMAIL.test(title);
    const inSession = readsIn(readsOf.get(app.toLowerCase()) ?? [], iv.start, iv.end);
    const learningReads = inSession.length > 0 && inSession.filter((r) => r.category === 'learning').length * 2 >= inSession.length;

    if (!BROWSER.test(app)) {
      if (learningReads && !hasEmail && !NOT_LEARNING.test(app)) learn(title.slice(0, PAGE_CHARS), app, ms);
      continue;
    }
    const p = parseBrowserTitle(title, EDGE.test(app) ? profile : undefined);
    if (!p || EMAIL.test(p.site)) continue; // no site: the time stays under the browser app only
    const page = hasEmail ? null : p.page;
    const site = add(sites, p.site, ms, () => ({ site: p.site, pages: new Map<string, number>() }));
    if (!page) continue;
    site.pages.set(page, (site.pages.get(page) ?? 0) + ms);
    const video = VIDEO_SITES.has(p.site);
    if (video) add(videos, `${p.site}\u0000${page}`, ms, () => ({ title: page, site: p.site }));
    if (NOT_LEARNING.test(p.site)) continue;
    if (LEARNING_SITES.has(p.site) || DOCS_HOST.test(p.site) || (video && LEARN_TITLE.test(page)) || learningReads) learn(page, p.site, ms);
  }

  return {
    apps: top(apps, 10).map(({ app, min }) => ({ app, min })),
    sites: top(sites, 10).map(({ site, min, pages }) => ({ site, min, pages: [...pages].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t) })),
    videos: top(videos, 10).map(({ title, site, min }) => ({ title, site, min })),
    games: top(games, 8).map(({ name, min }) => ({ name, min })),
    learning: top(learning, 8).map(({ title, where, min }) => ({ title, where, min }))
  };
}
