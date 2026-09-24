import { useEffect, useState } from 'react';
import { localDate } from '@worksight/core/date';
import type { DaylensSettings } from '../../main/settings';
import type { TodayView } from '../../main/day/today';
import { CATEGORY_LABEL, displayAppName, type Category } from '../../shared/categories';
import { api } from '../lib/api';
import { appColor, appInitials, formatClock, formatHm, joinApps } from '../lib/format';
import { Icon } from './Icon';
import { Timeline } from './Timeline';
import { HealthPanel } from './HealthPanel';

export function TodayScreen({ settings }: { settings: DaylensSettings }) {
  const [view, setView] = useState<TodayView | null>(null);
  const [filter, setFilter] = useState<Category | 'all'>('all');

  useEffect(() => {
    let alive = true;
    const load = (): void => { void api.today(localDate(Date.now())).then((v) => { if (alive) setView(v); }); };
    load();
    const off = api.onUpdate(load);
    const timer = setInterval(load, 30_000); // keeps the open session and "now" marker moving
    return () => { alive = false; off(); clearInterval(timer); };
  }, [settings.dailyGoalMin, settings.windDownTime, settings.breakIntervalMin]);

  if (!view) return <><main className="today" /><aside className="panel" /></>;

  const cards = view.cards.filter((c) => filter === 'all' || c.category === filter);
  const dateLabel = new Date(view.now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <main className="today">
        <p className="date">{dateLabel}{view.firstSeenAt !== null && ` · first on screen at ${formatClock(view.firstSeenAt)}`}</p>
        <h1 className="headline">
          {view.screenSec > 0 ? <>You spent <b>{formatHm(view.screenSec)}</b><br />on screen today</> : <>No screen time<br />yet today</>}
        </h1>

        {view.cards.length > 0 && (
          <div className="pills">
            <button className={`pill${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}><i><Icon name="all" /></i>All</button>
            {view.cards.map((c) => (
              <button key={c.category} className={`pill${filter === c.category ? ' on' : ''}`} onClick={() => setFilter(c.category)}>
                <i><Icon name={c.category} /></i>{CATEGORY_LABEL[c.category]}
              </button>
            ))}
          </div>
        )}

        <p className="sec">Where your time went</p>
        {cards.length === 0 ? (
          <div className="empty">Nothing tracked yet. Keep Daylens running and this fills in as you use your PC.</div>
        ) : (
          <div className="grid">
            {cards.map((c, i) => (
              <div key={c.category} className="card" style={{ ['--c' as string]: `var(--cat-${c.category})`, animationDelay: `${0.1 + i * 0.08}s` }}>
                <div className="ctop">
                  <span className="ico"><Icon name={c.category} /></span>{CATEGORY_LABEL[c.category]}
                  <span className="chip">{formatHm(c.seconds)}</span>
                </div>
                <h3>{joinApps(c.apps.map((a) => displayAppName(a.appName)))}</h3>
                <div className="cfoot">
                  <span>{Math.round((c.seconds / Math.max(1, view.screenSec)) * 100)}% of today</span>
                  <span className="apps">{c.apps.map((a) => <b key={a.appName} style={{ background: appColor(a.appName) }}>{appInitials(a.appName)}</b>)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <Timeline date={view.date} segments={view.timeline} now={view.now} longestStretchSec={view.health.longestStretchSec} highlight={filter} />
      </main>
      <HealthPanel view={view} />
    </>
  );
}
