import { finalCategory } from '../brain/finalCategory';
import { categoryForApp } from '../../shared/categories';
import type { EpisodeRead } from '../screen/labels';

const GAP_MS = 5 * 60_000;
const READ_MS = 30_000;     // one read stands for ~30 s of screen time
const SAMPLE_CHARS = 300;
const DEEP_MS = 25 * 60_000;

export interface Episode { id: string; start: number; end: number; app: string; category: string; activity: string | null;
  titles: string[]; samples: string[]; avgStuck: number; avgDistraction: number; stuckReads: number; reads: number; }

const catOf = (r: EpisodeRead): string => (r.category ? finalCategory(r.category, r.conf ?? 0, r.appName) : categoryForApp(r.appName));
const mean = (xs: (number | null)[]): number => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
function mode(xs: (string | null)[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function toEpisode(g: EpisodeRead[], category: string, withText: boolean): Episode {
  const titles = [...new Set(g.map((r) => r.windowTitle).filter((t): t is string => !!t))].slice(0, 3);
  const samples = withText
    ? [...g].filter((r) => r.text).sort((a, b) => (b.stuck ?? 0) - (a.stuck ?? 0) || a.at - b.at)
        .map((r) => (r.text as string).slice(0, SAMPLE_CHARS)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 3)
    : [];
  return { id: `e${g[0].id}`, start: g[0].at, end: g[g.length - 1].at + READ_MS, app: g[0].appName, category, activity: mode(g.map((r) => r.activity)),
    titles, samples, avgStuck: mean(g.map((r) => r.stuck)), avgDistraction: mean(g.map((r) => r.distraction)),
    stuckReads: g.filter((r) => (r.stuck ?? 0) >= 2).length, reads: g.length };
}

/** Consecutive reads of the same app and final category, gaps under 5 min. `withText` = screen reading on. */
export function buildEpisodes(reads: EpisodeRead[], withText: boolean): Episode[] {
  const out: Episode[] = [];
  let g: EpisodeRead[] = [], cat = '';
  for (const r of [...reads].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const c = catOf(r);
    const last = g[g.length - 1];
    if (last && (r.appName !== last.appName || c !== cat || r.at - last.at >= GAP_MS)) { out.push(toEpisode(g, cat, withText)); g = []; }
    if (!g.length) cat = c;
    g.push(r);
  }
  if (g.length) out.push(toEpisode(g, cat, withText));
  return out;
}

export const deepWorkSec = (episodes: Episode[]): number =>
  episodes.filter((e) => (e.category === 'work' || e.category === 'learning') && e.end - e.start >= DEEP_MS && e.avgDistraction < 0.5)
    .reduce((a, e) => a + (e.end - e.start) / 1000, 0);
