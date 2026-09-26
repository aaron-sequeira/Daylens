import { useEffect, useState } from 'react';
import type { ReportView } from '../../main/report/view';
import type { ReportStats } from '../../main/report/input';

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

export type CardKind = 'report' | 'writing' | 'waiting' | 'failed' | 'download' | 'cloud_offer' | 'empty' | 'generate';
export function reportCardKind(v: ReportView): CardKind {
  if (v.status === 'ready') return 'report';
  if (v.running || v.status === 'pending') return 'writing';
  if (v.writer.state === 'unavailable' || v.writer.state === 'cloud_setup') return 'cloud_offer';
  if (v.writer.state === 'missing' || v.writer.state === 'downloading' || v.writer.state === 'verifying') return 'download';
  if (v.waiting) return 'waiting';
  if (v.status === 'failed') return 'failed';
  if (!v.stats || v.stats.screenSec === 0) return 'empty';
  return 'generate';
}

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
