import type { TodayView } from '../../main/day/today';
import { CATEGORIES } from '../../shared/categories';
import { formatHm, healthLabel } from '../lib/format';

const RING = 201; // 2πr for r = 32

export function HealthPanel({ view }: { view: TodayView }) {
  const { health, week } = view;
  const max = Math.max(1, ...week.map((d) => d.seconds));
  const tracked = week.filter((d) => d.seconds > 0);
  const avgSec = tracked.length ? tracked.reduce((a, d) => a + d.seconds, 0) / tracked.length : 0;
  const goalPct = view.goalSec > 0 ? view.screenSec / view.goalSec : 0;
  const details = [
    `${health.breaks} break${health.breaks === 1 ? '' : 's'} taken`,
    `longest stretch ${formatHm(health.longestStretchSec)}`,
    health.lateNight ? 'late-night use' : 'no late-night use'
  ].join(' · ');

  return (
    <aside className="panel">
      <p className="ptitle">Screen health</p>
      <div className="box health">
        <div className="ring">
          <svg width="78" height="78">
            <circle cx="39" cy="39" r="32" stroke="#F2EBE6" strokeWidth="9" fill="none" />
            <circle className="p" cx="39" cy="39" r="32" stroke="#7FD1A8" strokeWidth="9" fill="none" strokeLinecap="round"
              style={{ ['--to' as string]: `${RING * (1 - health.score / 100)}px` }} />
          </svg>
          <div className="val">{health.score}</div>
        </div>
        <div><h4>{healthLabel(health.score)}</h4><p>{details}</p></div>
      </div>

      <div className="box" style={{ animationDelay: '.1s' }}>
        <div className="bhead">Daily goal <span>under {formatHm(view.goalSec)}</span></div>
        <div className="big"><b>{formatHm(view.screenSec)}</b><span>{goalPct <= 1 ? `${formatHm(view.goalSec - view.screenSec)} left` : `${formatHm(view.screenSec - view.goalSec)} over`}</span></div>
        <div className="gbar"><div className={goalPct > 1 ? 'over' : ''} style={{ width: `${Math.min(100, goalPct * 100)}%` }} /></div>
      </div>

      <div className="box" style={{ animationDelay: '.2s' }}>
        <div className="bhead">Screen time · last 7 days</div>
        <div className="big"><b>{formatHm(avgSec)}</b><span>average on tracked days</span></div>
        <div className="bars">
          {week.map((d, i) => {
            const isToday = i === week.length - 1;
            const label = isToday ? 'Today' : new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' });
            return (
              <div key={d.date} className={`bar${isToday ? ' today' : ''}`} title={`${label}: ${formatHm(d.seconds)}`}>
                <div className="stack" style={{ height: `${d.seconds > 0 ? Math.max(6, (d.seconds / max) * 90) : 0}px`, animationDelay: `${0.3 + i * 0.08}s` }}>
                  {CATEGORIES.filter((c) => d.byCategory[c] > 0).map((c) => (
                    <div key={c} style={{ height: `${(d.byCategory[c] / d.seconds) * 100}%`, background: `var(--cat-${c})` }} />
                  ))}
                </div>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
