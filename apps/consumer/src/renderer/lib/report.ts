import { useEffect, useState } from 'react';
import type { ReportView } from '../../main/report/view';
import type { ReportStats } from '../../main/report/input';
import type { DayDetail } from '../../main/report/detail';

// Ledger ruling: 'en-GB' keeps the format (and its unit test) machine-independent.
export function reportDateLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  if ((new Date(ty, tm - 1, td).getTime() - t.getTime()) / 86_400_000 === 1) return 'Yesterday';
  return t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
export const goalPercent = (s: Pick<ReportStats, 'screenSec' | 'goalSec'>): number => (s.goalSec > 0 ? Math.round((s.screenSec / s.goalSec) * 100) : 0);
// ponytail: buildStats already clamps activeSec to screenSec; this caps display too, belt and suspenders.
export const activePercent = (s: Pick<ReportStats, 'screenSec' | 'activeSec'>): number =>
  (s.screenSec > 0 ? Math.min(100, Math.round((s.activeSec / s.screenSec) * 100)) : 0);

export type CardKind = 'report' | 'writing' | 'waiting' | 'failed' | 'download' | 'cloud_offer' | 'empty' | 'generate';
export function reportCardKind(v: ReportView): CardKind {
  if (v.status === 'ready') return 'report';
  if (v.running || v.status === 'pending') return 'writing';
  if (v.writer.state === 'unavailable' || v.writer.state === 'cloud_setup') return 'cloud_offer';
  if (v.writer.state === 'missing' || v.writer.state === 'downloading' || v.writer.state === 'verifying') return 'download';
  if (v.waiting || v.queued) return 'waiting';
  if (v.status === 'failed') return 'failed';
  if (!v.stats || v.stats.screenSec === 0) return 'empty';
  return 'generate';
}

/** A value from the date picker, or null when it's empty, outside [min, max], or a half-typed year (< 2000). */
export function pickDate(value: string, min: string | undefined, max: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > max || (min !== undefined && value < min)) return null;
  return value;
}

/** Why a requested write hasn't started. Local mode short of memory (main's byte-exact `memoryShort`) gets the real
 * numbers; otherwise the writer is waiting on labelling (the two never run at once). */
export function waitingText(v: Pick<ReportView, 'memoryShort' | 'needGb' | 'freeGb'>, rewrite: boolean): string {
  if (v.memoryShort) {
    return `Waiting for memory to ${rewrite ? 'rewrite' : 'write'}: needs ${v.needGb.toFixed(1)} GB free, ${v.freeGb.toFixed(1)} GB free now. It starts by itself when memory frees up.`;
  }
  return 'Waiting for Daylens to finish another job. It starts by itself when that is done.';
}

export interface DetailPanel { title: string; rows: { name: string; min: number; sub: string[] }[]; }
/** "Your day in detail" panels in display order; empty panels are left out (an empty list hides the section). */
export function detailPanels(d: DayDetail): DetailPanel[] {
  return [
    { title: 'Apps', rows: d.apps.map((a) => ({ name: a.app, min: a.min, sub: [] })) },
    { title: 'Websites', rows: d.sites.map((s) => ({ name: s.site, min: s.min, sub: s.pages })) },
    { title: 'Videos', rows: d.videos.map((v) => ({ name: v.title, min: v.min, sub: [v.site] })) },
    { title: 'Games', rows: d.games.map((g) => ({ name: g.name, min: g.min, sub: [] })) },
    { title: 'Learning', rows: d.learning.map((l) => ({ name: l.title, min: l.min, sub: [l.where] })) }
  ].filter((p) => p.rows.length > 0);
}

// Must match the SNIPPET_MARK_OPEN/CLOSE control characters main/report/search.ts's snippet() call uses:
// unusual enough that they never collide with literal "[" / "]" (or anything else) typed in a real report.
const MARK_OPEN = '\u0001';
const MARK_CLOSE = '\u0002';
/** Splits an FTS `snippet()` result into plain data the renderer turns into text and `<mark>` nodes itself,
 * so a search hit is never rendered with dangerouslySetInnerHTML. */
export function snippetParts(snippet: string): { text: string; mark: boolean }[] {
  return snippet.split(new RegExp(`(${MARK_OPEN}[^${MARK_OPEN}${MARK_CLOSE}]*${MARK_CLOSE})`, 'g')).filter((s) => s !== '')
    .map((s) => (s.startsWith(MARK_OPEN) && s.endsWith(MARK_CLOSE) ? { text: s.slice(1, -1), mark: true } : { text: s, mark: false }));
}

/** The next highlighted index for ArrowUp/ArrowDown in the search results dropdown, wrapping at both ends;
 * -1 means nothing highlighted yet (ArrowDown from -1 goes to the first result, ArrowUp to the last). Any
 * other key leaves the index unchanged. */
export function nextIndex(i: number, len: number, key: string): number {
  if (len <= 0) return -1;
  if (key === 'ArrowDown') return i < 0 || i >= len - 1 ? 0 : i + 1;
  if (key === 'ArrowUp') return i <= 0 ? len - 1 : i - 1;
  return i;
}

/** The Email button's state: `pending` disables the button (a second click can't fire a second IPC request
 * while the first is still in flight), and `status` is the note shown underneath. */
export interface EmailState { pending: boolean; status: string | null; }
export const EMAIL_IDLE: EmailState = { pending: false, status: null };
/** Starting a request: busy, and clears any note left over from the previous one. */
export const emailStart = (): EmailState => ({ pending: true, status: null });
/** The request settling, ok or not: no longer busy, showing a reason only on failure. */
export const emailFinished = (reason: string | null): EmailState => ({ pending: false, status: reason });

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Animated count from 0 to `target` over ~900 ms; returns the target straight away when motion is reduced or disabled. */
export function useCountUp(target: number, enabled: boolean): number {
  const [v, setV] = useState(enabled && !reduced() ? 0 : target);
  useEffect(() => {
    if (!enabled || reduced()) { setV(target); return; }
    const t0 = performance.now(); let raf = 0;
    const step = (t: number): void => { const p = Math.min(1, (t - t0) / 900); setV(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return v;
}
