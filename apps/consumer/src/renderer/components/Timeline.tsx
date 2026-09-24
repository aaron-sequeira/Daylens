import type { TimelineSegment } from '../../main/day/today';
import type { Category } from '../../shared/categories';
import { formatHm, hourLabel } from '../lib/format';

const HOUR = 3_600_000;

export function Timeline({ date, segments, now, longestStretchSec, highlight }: {
  date: string; segments: TimelineSegment[]; now: number; longestStretchSec: number; highlight: Category | 'all';
}) {
  const [y, m, d] = date.split('-').map(Number);
  const midnight = new Date(y, m - 1, d).getTime();
  const firstH = segments.length ? Math.floor((segments[0].start - midnight) / HOUR) : 8;
  const lastH = segments.length ? Math.ceil((segments[segments.length - 1].end - midnight) / HOUR) : 22;
  const startH = Math.min(8, firstH);
  const endH = Math.min(24, Math.max(22, lastH));
  const origin = midnight + startH * HOUR;
  const span = (endH - startH) * HOUR;
  const pct = (t: number): number => Math.min(100, Math.max(0, ((t - origin) / span) * 100));
  const ticks: number[] = [];
  for (let h = startH; h <= endH; h += 2) ticks.push(h);
  const showNow = now >= origin && now <= origin + span;

  return (
    <div className="tl">
      <p className="sec" style={{ marginBottom: 10 }}>Your day <span>Longest stretch without a break: {formatHm(longestStretchSec)}</span></p>
      <div className="tlbar">
        {segments.map((s, i) => (
          <div key={i} className="seg" style={{
            left: `${pct(s.start)}%`, width: `${Math.max(0.3, pct(s.end) - pct(s.start))}%`,
            ['--c' as string]: `var(--cat-${s.category})`, animationDelay: `${0.3 + i * 0.03}s`,
            opacity: highlight === 'all' || highlight === s.category ? 1 : 0.25
          }} />
        ))}
        {showNow && <div className="now" style={{ left: `${pct(now)}%` }} />}
      </div>
      <div className="ticks">
        {ticks.map((h) => <span key={h} style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }}>{hourLabel(h)}</span>)}
      </div>
    </div>
  );
}
