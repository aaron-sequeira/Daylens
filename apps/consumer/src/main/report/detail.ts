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
const NOT_SCREEN = /^lockapp(\.exe)?$/i; // Windows lock screen (as in day/today.ts)
const BROWSER = /^(google chrome|chrome|microsoft edge|msedge|mozilla firefox|firefox|brave|brave browser|opera|opera gx|vivaldi|arc)$/i;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const BROWSER_SUFFIX = /\s+[-—–|]\s+(?:google chrome|microsoft\s*edge|mozilla firefox|firefox|brave|opera|vivaldi|arc)\s*$/i;
const PROFILE_SUFFIX = /\s+[-—–]\s+(?:personal|work|guest|default|profile \d+)\s*$/i;
const MORE_PAGES = /\s+and \d+ more pages?\s*$/i;
const COUNTER = /^\(\d+\+?\)\s*/;
const BLANK = /^(new tab|new private tab|start page|blank page|untitled)$/i;
const PRIVATE = /InPrivate|Incognito|Private Browsing/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const SITE_NAMES: Record<string, string> = Object.fromEntries(([
  ['youtube', 'YouTube'], ['stack overflow', 'Stack Overflow'], ['stackoverflow', 'Stack Overflow'], ['github', 'GitHub'], ['gmail', 'Gmail'],
  ['reddit', 'Reddit'], ['x', 'X'], ['twitter', 'X'], ['mdn', 'MDN Web Docs'], ['mdn web docs', 'MDN Web Docs'], ['netflix', 'Netflix'],
  ['twitch', 'Twitch'], ['prime video', 'Prime Video'], ['amazon prime video', 'Prime Video'], ['disney+', 'Disney+'], ['disney plus', 'Disney+'],
  ['vimeo', 'Vimeo'], ['crunchyroll', 'Crunchyroll'], ['w3schools', 'W3Schools'], ['coursera', 'Coursera'], ['udemy', 'Udemy'],
  ['khan academy', 'Khan Academy'], ['freecodecamp', 'freeCodeCamp'], ['wikipedia', 'Wikipedia'], ['geeksforgeeks', 'GeeksforGeeks'],
  ['real python', 'Real Python'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['google search', 'Google Search'],
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude']
] as const).map(([k, v]) => [k, v]));
const VIDEO_SITES = new Set(['YouTube', 'Netflix', 'Twitch', 'Prime Video', 'Disney+', 'Vimeo', 'Crunchyroll']);
const LEARNING_SITES = new Set(['MDN Web Docs', 'Stack Overflow', 'W3Schools', 'Coursera', 'Udemy', 'Khan Academy', 'freeCodeCamp', 'Wikipedia', 'GeeksforGeeks', 'Real Python']);
const DOCS_SITE = /^docs\.|\bdocs\b|documentation/i;
const LEARN_TITLE = /tutorial|course|lesson|learn|how to|explained|guide/i;
const KNOWN_GAMES = ['deadlock', 'valorant', 'leagueoflegends', 'minecraft', 'fortnite', 'cs2', 'dota2', 'overwatch', 'apexlegends', 'roblox', 'rocketleague', 'genshinimpact'];
const NOT_GAMES = /steam|big picture|launcher|riot client|battle\.net|epic games/i; // launchers and Steam Big Picture aren't games

const normSite = (raw: string): string => SITE_NAMES[raw.toLowerCase()] ?? raw;

/** A browser window title → site + page. Strips the browser name (incl. Edge's zero-width characters), profile names,
 * "and N more pages", and a leading "(3) " counter. The site is the last " - " / " | " / " — " segment, normalised when
 * known; the page is the rest (≤ 80 chars), or null when the title is just the site. Blank tabs give null. */
export function parseBrowserTitle(title: string): { site: string; page: string | null } | null {
  const rest = title.replace(ZERO_WIDTH, '').trim()
    .replace(BROWSER_SUFFIX, '').replace(PROFILE_SUFFIX, '').replace(MORE_PAGES, '').replace(COUNTER, '').trim();
  if (!rest || BLANK.test(rest)) return null;
  const m = rest.match(/^(.*)\s\/\s(X|Twitter)$/i) ?? rest.match(/^(.*)\s[-|—–]\s(.+)$/);
  if (!m) return { site: normSite(rest), page: null };
  const site = normSite(m[2].trim());
  const page = m[1].trim().slice(0, PAGE_CHARS);
  return { site, page: page && page.toLowerCase() !== site.toLowerCase() ? page : null };
}

const isGame = (app: string, gaming: Set<string>): boolean => {
  if (NOT_GAMES.test(app)) return false;
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

export function buildDayDetail(i: { sessions: FocusSessionRow[]; reads: DetailRead[]; now: number; exclusions: string[] }): DayDetail {
  const sorted = [...i.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const latest = sorted[sorted.length - 1];
  const readsOf = new Map<string, DetailRead[]>();
  for (const r of i.reads) { const k = displayAppName(r.appName).toLowerCase(); readsOf.set(k, [...(readsOf.get(k) ?? []), r]); }
  const gaming = new Set([...readsOf].filter(([, rs]) => rs.filter((r) => r.activity === 'gaming').length * 2 >= rs.length).map(([k]) => k));

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
    const inSession = (readsOf.get(app.toLowerCase()) ?? []).filter((r) => r.at >= iv.start && r.at <= iv.end);
    const learningReads = inSession.length > 0 && inSession.filter((r) => r.category === 'learning').length * 2 >= inSession.length;

    if (!BROWSER.test(app)) {
      if (learningReads && !EMAIL.test(title)) learn(title.slice(0, PAGE_CHARS), app, ms);
      continue;
    }
    const p = parseBrowserTitle(title);
    if (!p) continue;
    const page = p.page && !EMAIL.test(p.page) ? p.page : null;
    const site = add(sites, p.site, ms, () => ({ site: p.site, pages: new Map<string, number>() }));
    if (!page) continue;
    site.pages.set(page, (site.pages.get(page) ?? 0) + ms);
    const video = VIDEO_SITES.has(p.site);
    if (video) add(videos, `${p.site}\u0000${page}`, ms, () => ({ title: page, site: p.site }));
    if (LEARNING_SITES.has(p.site) || DOCS_SITE.test(p.site) || (video && LEARN_TITLE.test(page)) || learningReads) learn(page, p.site, ms);
  }

  return {
    apps: top(apps, 10).map(({ app, min }) => ({ app, min })),
    sites: top(sites, 10).map(({ site, min, pages }) => ({ site, min, pages: [...pages].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t) })),
    videos: top(videos, 10).map(({ title, site, min }) => ({ title, site, min })),
    games: top(games, 8).map(({ name, min }) => ({ name, min })),
    learning: top(learning, 8).map(({ title, where, min }) => ({ title, where, min }))
  };
}
