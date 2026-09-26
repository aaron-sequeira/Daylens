import { useEffect, useState } from 'react';
import type { ReportView, WriterView } from '../../main/report/view';
import type { PlanKind } from '../../main/report/schema';
import { CATEGORY_LABEL, displayAppName, type Category } from '../../shared/categories';
import { api } from '../lib/api';
import { appColor, appInitials, formatHm } from '../lib/format';
import { goalPercent, reportCardKind, reportDateLabel, useCountUp, words } from '../lib/report';
import { writerStatusText } from '../lib/writer';
import { CloudSetup } from './CloudSetup';

const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  focus_block: 'focus mode', app_cap: 'app limit', break_interval: 'health nudge', wind_down: 'wind-down'
};

export function ReportsScreen({ print = false, date: fixedDate }: { print?: boolean; date?: string }) {
  const [date, setDate] = useState<string | null>(fixedDate ?? null);
  const [view, setView] = useState<ReportView | null>(null);
  const [writer, setWriter] = useState<WriterView | null>(null);
  const [showCloud, setShowCloud] = useState(false);

  const load = (): void => {
    api.reports.get(date).then(setView).catch((e) => console.error('[renderer] reports.get failed:', e)); // Task 11 adds the print-ready signal
    api.writer.get().then(setWriter).catch(() => {});
  };
  useEffect(() => { load(); if (print) return; return api.onUpdate(load); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const animate = !print;
  const score = useCountUp(view?.stats?.health.score ?? 0, animate);

  if (!view) return <><main className="report" /><aside className="panel" /></>;

  const kind = reportCardKind(view);
  const stats = view.stats;
  const report = view.report;

  const regenerate = (): void => { api.reports.generate(view.date).then(setView).catch(() => {}); };

  const statusCard = () => {
    switch (kind) {
      case 'writing':
        return <div className="report-card"><p>Writing your report…</p></div>;
      case 'waiting':
        return <div className="report-card"><p>Waiting for a quiet moment to write your report (it needs about 3.5 GB of free memory).</p></div>;
      case 'failed':
        return (
          <div className="report-card">
            <p>Couldn't write this report: {view.error}</p>
            <div className="btn-row"><button className="btn" onClick={regenerate}>Retry</button></div>
          </div>
        );
      case 'download':
        return (
          <div className="report-card">
            <p>Download the writer ({writerStatusText(view.writer)}) for written reports</p>
            <div className="btn-row">
              <button className="btn" onClick={() => { api.writer.download().then(setWriter).catch(() => {}); }}>Download</button>
              <button className="btn s" onClick={() => setShowCloud((v) => !v)}>Use cloud instead</button>
            </div>
            {showCloud && writer && <CloudSetup view={writer} onSaved={(v) => { setWriter(v); load(); }} />}
          </div>
        );
      case 'cloud_offer':
        return (
          <div className="report-card">
            <p>Can't write reports on this PC? Use your own AI key</p>
            {view.writer.state === 'unavailable' && <p className="report-note">{view.writer.text}</p>}
            {writer && (
              <>
                <p className="report-note">Or use your own AI key:</p>
                <CloudSetup view={writer} onSaved={(v) => { setWriter(v); load(); }} />
              </>
            )}
          </div>
        );
      case 'generate':
        return (
          <div className="report-card">
            <p>No report yet for this day</p>
            <div className="btn-row"><button className="btn" onClick={regenerate}>Generate</button></div>
          </div>
        );
      case 'empty':
        return <div className="report-card"><p>Nothing tracked on this day.</p></div>;
      default:
        return null;
    }
  };

  const screenDeltaPct = stats && stats.weekAvgSec > 0 ? Math.round(((stats.screenSec - stats.weekAvgSec) / stats.weekAvgSec) * 100) : null;
  const activePct = stats && stats.screenSec > 0 ? Math.round((stats.activeSec / stats.screenSec) * 100) : 0;
  const deepPct = stats && stats.activeSec > 0 ? Math.round((stats.deepWorkSec / stats.activeSec) * 100) : 0;
  const topMax = stats?.topApps[0]?.seconds ?? 0;

  return (
    <>
      <main className="report">
        <div className="rhead">
          {!print && <button className="arrow" disabled={!view.prevDate} aria-label="Previous day" onClick={() => setDate(view.prevDate)}>‹</button>}
          {!print && <button className="arrow" disabled={!view.nextDate} aria-label="Next day" onClick={() => setDate(view.nextDate)}>›</button>}
          <span className="date">{reportDateLabel(view.date, view.today)}</span>
          {kind === 'report' && view.model && (
            <span className="badge"><i />Written {view.writer.state === 'ready' && view.writer.mode === 'local' ? 'on-device' : 'in the cloud'} · {view.model}</span>
          )}
          {!print && <button className="btn s" onClick={regenerate}>Regenerate</button>}
        </div>

        {kind === 'report' && report ? (
          <>
            <h1>{report.headline}</h1>
            <h2>How your day went</h2>
            <p className="story">
              {print ? report.story : words(report.story).map((w, i) => (
                <span key={i} style={{ animationDelay: `${i * 30}ms` }}>{w} </span>
              ))}
            </p>
          </>
        ) : statusCard()}

        {stats && stats.screenSec > 0 && (
          <div className="stats">
            <div className="stat" style={{ animationDelay: '.1s' }}>
              <small>Screen time</small><b>{formatHm(stats.screenSec)}</b>
              {screenDeltaPct !== null && (
                <em className={screenDeltaPct <= 0 ? 'down' : 'up'}>{screenDeltaPct <= 0 ? '↓' : '↑'} {Math.abs(screenDeltaPct)}% vs avg</em>
              )}
            </div>
            <div className="stat" style={{ animationDelay: '.16s' }}><small>Actively used</small><b>{formatHm(stats.activeSec)}</b><em className="flat">{activePct}% of screen time</em></div>
            <div className="stat" style={{ animationDelay: '.22s' }}><small>Deep work</small><b>{formatHm(stats.deepWorkSec)}</b><em className="flat">{deepPct}% of active</em></div>
            <div className="stat" style={{ animationDelay: '.28s' }}><small>App switches</small><b>{stats.switches}</b></div>
            <div className="stat" style={{ animationDelay: '.34s' }}><small>Breaks</small><b>{stats.health.breaks}</b><em className="flat">goal: {stats.health.expectedBreaks}</em></div>
          </div>
        )}

        {kind === 'report' && report && (
          <>
            <div className="cols">
              <div className="blk" style={{ background: 'var(--mint)', animationDelay: '.3s' }}>
                <h2>Wins</h2>
                <ul>{report.wins.map((w, i) => <li key={i}><i>{i + 1}</i>{w}</li>)}</ul>
              </div>
              <div className="blk" style={{ background: 'var(--pink)', animationDelay: '.38s' }}>
                <h2>Habits to watch</h2>
                <ul>{report.habits.map((h, i) => <li key={i}><i>{i + 1}</i>{h}</li>)}</ul>
              </div>
            </div>

            {report.doBetter.length > 0 && (
              <div className="better">
                <h2>Do it better <span>· things the AI saw you do the slow way</span></h2>
                {report.doBetter.map((d, i) => {
                  const candidate = view.candidates.find((c) => c.id === d.candidateId);
                  return (
                    <div className="fix" key={i}>
                      <div className="was">
                        <small>What happened</small>{d.what}
                        {!print && candidate?.sample && (
                          <details><summary>Screen extract</summary><p>{candidate.sample}</p></details>
                        )}
                      </div>
                      <div className="now"><small>Faster way</small>{d.better}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {report.plan.length > 0 && (
              <div className="plan">
                <h2>Plan for tomorrow <span>· tick to turn into reminders</span></h2>
                {report.plan.map((p, i) => (
                  <label key={i}>
                    <input type="checkbox" checked={view.ticked.includes(p.text)} disabled={print}
                      onChange={(e) => { api.reports.tickPlan(view.date, i, e.target.checked).then(setView).catch(() => {}); }} />
                    {p.text}<span className="add">{PLAN_KIND_LABEL[p.kind]}</span>
                  </label>
                ))}
              </div>
            )}

            {view.model && <p className="report-footer">Written by {view.model}</p>}
          </>
        )}
      </main>

      {stats && stats.screenSec > 0 ? (
        <aside className="panel report">
          <div className="box" style={{ animationDelay: '.2s' }}>
            <h3>Daily goal <span>under {formatHm(stats.goalSec)}</span></h3>
            <div className="goal">
              <b>{formatHm(stats.screenSec)}</b>
              <span>/ {formatHm(stats.goalSec)}, {stats.screenSec <= stats.goalSec ? `${formatHm(stats.goalSec - stats.screenSec)} left` : `${formatHm(stats.screenSec - stats.goalSec)} over`}</span>
            </div>
            <div className="gbar"><div style={{ width: `${Math.min(100, goalPercent(stats))}%` }} /></div>
          </div>

          {stats.topApps.length > 0 && (
            <div className="box" style={{ animationDelay: '.3s' }}>
              <h3>Top apps <span>today</span></h3>
              {stats.topApps.map((a) => (
                <div className="app" key={a.appName}>
                  <b className="lg" style={{ background: appColor(a.appName) }}>{appInitials(a.appName)}</b>
                  <div>{displayAppName(a.appName)}<div className="tr"><div style={{ width: `${topMax > 0 ? Math.round((a.seconds / topMax) * 100) : 0}%` }} /></div></div>
                  <em>{formatHm(a.seconds)}</em>
                </div>
              ))}
            </div>
          )}

          {stats.categories.length > 0 && (
            <div className="box" style={{ animationDelay: '.36s' }}>
              <h3>Time by category</h3>
              {[...stats.categories].sort((a, b) => b.seconds - a.seconds).map((c) => (
                <div className="hrow" key={c.category}><span>{CATEGORY_LABEL[c.category as Category] ?? c.category}</span><span>{formatHm(c.seconds)}</span></div>
              ))}
            </div>
          )}

          <div className="box" style={{ animationDelay: '.4s' }}>
            <h3>Health check <span>score {score}</span></h3>
            <div className="hrow">Breaks<span className={stats.health.breaks >= stats.health.expectedBreaks ? 'ok' : 'meh'}>{stats.health.breaks} / {stats.health.expectedBreaks}</span></div>
            <div className="hrow">Longest non-stop stretch<span className={stats.health.longestStretchSec <= 3600 ? 'ok' : 'meh'}>{formatHm(stats.health.longestStretchSec)}</span></div>
            <div className="hrow">Late-night use<span className={stats.health.lateNight ? 'meh' : 'ok'}>{stats.health.lateNight ? 'Yes' : 'None'}</span></div>
            <div className="hrow">Screen time vs goal<span className={stats.screenSec <= stats.goalSec ? 'ok' : 'meh'}>{stats.screenSec <= stats.goalSec ? 'Under' : 'Over'}</span></div>
          </div>

          {kind === 'report' && report?.advice && (
            <div className="box" style={{ background: 'var(--lav)', animationDelay: '.5s' }}>
              <h3>Coach's advice</h3>
              <p>{report.advice}</p>
            </div>
          )}
        </aside>
      ) : <aside className="panel" />}
    </>
  );
}
