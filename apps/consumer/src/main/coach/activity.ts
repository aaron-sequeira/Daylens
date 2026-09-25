import type { ActivitySampleRow, FocusSessionRow } from '@worksight/core/types';
import { atLeast, restPeriods } from '../day/time';
import { BREAK_MS } from '../day/health';
import { displayAppName } from '../../shared/categories';
import { isExcluded } from '../screen/exclusions';

const RECENT_MS = 2 * 60_000; // the user counts as "at it" if the latest bucket ended this recently

export function currentStretch(samples: ActivitySampleRow[], now: number, lastBreakAt: number | null): { start: number; ms: number } | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.bucketStart - b.bucketStart);
  if (now - sorted[sorted.length - 1].bucketEnd > RECENT_MS) return null;
  const rests = atLeast(restPeriods(sorted), BREAK_MS);
  let start = rests.length ? rests[rests.length - 1].end : sorted[0].bucketStart;
  if (lastBreakAt !== null && lastBreakAt > start) start = lastBreakAt;
  return { start, ms: now - start };
}

export const hm = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);

export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** App switches that started in (from, to]: the tracker also splits sessions on title/pid changes, so only
 * consecutive sessions whose appName differs count. */
export function switchesBetween(sessions: FocusSessionRow[], from: number, to: number): number {
  const sorted = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  let n = 0;
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.startedAt > from && s.startedAt <= to && s.appName !== sorted[i - 1].appName) n++;
  }
  return n;
}

const appKey = (a: string): string => displayAppName(a).toLowerCase();

/** True when the latest focus session is in `appName` — labels can arrive up to 30 min late, so "right now"
 * rules check the user hasn't moved on since the read. */
export function stillIn(sessions: FocusSessionRow[], appName: string): boolean {
  let last: FocusSessionRow | null = null;
  for (const s of sessions) if (!last || s.startedAt >= last.startedAt) last = s;
  return last !== null && appKey(last.appName) === appKey(appName);
}

/** Titled focus sessions as search candidates, minus anything the user's privacy exclusions cover. */
export function searchTitlesFrom(sessions: FocusSessionRow[], exclusions: string[]): { at: number; title: string }[] {
  return sessions.flatMap((x) => (x.windowTitle && !isExcluded(exclusions, x.appName, x.windowTitle) ? [{ at: x.startedAt, title: x.windowTitle }] : []));
}

// Note: Microsoft Edge window titles contain a zero-width space (​) after "Microsoft", so the regex includes ​? to match it.
const BROWSER_SUFFIX = /\s[-—–]\s(Google Chrome|Microsoft​? Edge|Mozilla Firefox|Brave|Opera|Vivaldi)$/i;
const ENGINES = [/^(.+?)\s-\sGoogle Search$/i, /^(.+?)\s-\sBing$/i, /^(.+?)\sat DuckDuckGo$/i];

/** 'react hooks - Google Search - Google Chrome' → 'react hooks'; null when the title isn't a search. */
export function normaliseSearch(title: string): string | null {
  const t = title.replace(BROWSER_SUFFIX, '').trim();
  for (const re of ENGINES) {
    const m = re.exec(t);
    if (m) { const q = m[1].toLowerCase().replace(/\s+/g, ' ').trim(); return q || null; }
  }
  return null;
}
