import { useEffect, useRef, useState } from 'react';
import { localDate } from '@worksight/core/date';
import type { InsightsView } from '../../main/ipc';
import type { WriterView } from '../../main/report/view';
import { CATEGORIES, CATEGORY_LABEL, displayAppName } from '../../shared/categories';
import { api } from '../lib/api';
import { formatHm } from '../lib/format';
import { AppBadge } from './AppBadge';
import { dayShortLabel, deltaText, summaryCardKind, weekLabel, weekReady } from '../lib/insights';
import { waitingText } from '../lib/report';
import { writerStatusText } from '../lib/writer';
import { CloudSetup } from './CloudSetup';

const sizeGb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;
// .up is styled red and .down green (screen time: more is worse). Deep work passes higherIsBetter to swap the colours.
const deltaClass = (text: string, higherIsBetter = false): string => {
  const up = text.startsWith('↑');
  if (!up && !text.startsWith('↓')) return 'flat';
  return up !== higherIsBetter ? 'up' : 'down';
};

export function InsightsScreen() {
  const today = localDate(Date.now());
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [view, setView] = useState<InsightsView | null>(null);
  const [writer, setWriter] = useState<WriterView | null>(null);
  const [showCloud, setShowCloud] = useState(false);

  // Guards stale IPC results: only apply a resolved InsightsView if it's still for the week on screen.
  const weekRef = useRef<string | null>(weekStart);
  useEffect(() => { weekRef.current = weekStart; }, [weekStart]);
  const accept = (v: InsightsView): boolean => weekRef.current === null || weekRef.current === v.weekStart;

  const load = (): void => {
    api.insights.get(weekStart).then((v) => { if (accept(v)) setView(v); }).catch((e) => console.error('[renderer] insights.get failed:', e));
    api.writer.get().then(setWriter).catch((e) => console.error('[renderer] writer.get failed:', e));
  };
  useEffect(() => {
    let alive = true;
    const guarded = (): void => { if (alive) load(); };
    guarded();
    const off = api.onUpdate(guarded);
    return () => { alive = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  if (!view) return <><main className="report" /><aside className="panel" /></>;

  const kind = summaryCardKind(view);
  const n = view.numbers;

  const act = (p: Promise<InsightsView>, label: string): void => {
    p.then((v) => { if (accept(v)) setView(v); }).catch((e) => { console.error(`[renderer] ${label} failed:`, e); load(); });
  };
  const generate = (): void => { act(api.insights.generate(view.weekStart), 'insights.generate'); };
  const cancel = (): void => { act(api.insights.cancel(view.weekStart), 'insights.cancel'); };
  const queued = (view.waiting || view.queued) && !view.running;
  const localWriter = view.writer.state === 'ready' && view.writer.mode === 'local';
  const ready = weekReady(view.weekStart, today);

  const waitingLine = (rewrite: boolean) => (
    <div className="report-waiting" role="status">
      <p className="report-note">{waitingText(view, rewrite)}</p>
      <div className="btn-row">
        {view.cancellable && <button className="btn s" onClick={cancel}>Cancel</button>}
        {localWriter && <button className="linkish" onClick={() => setShowCloud((v) => !v)}>Use cloud instead</button>}
      </div>
      {localWriter && showCloud && writer && <CloudSetup view={writer} onSaved={(v) => { setWriter(v); load(); }} />}
    </div>
  );
  const download = (): void => { api.writer.download().then(setWriter).catch((e) => { console.error('[renderer] writer.download failed:', e); load(); }); };
  const cancelDownload = (): void => { api.writer.cancelDownload().then(setWriter).catch((e) => { console.error('[renderer] writer.cancelDownload failed:', e); load(); }); };

  const summaryCard = () => {
    switch (kind) {
      case 'summary': {
        const r = view.row!.report!;
        return (
          <div className="report-card">
            <h1>{r.headline}</h1>
            <p className="story">{r.summary}</p>
            <div className="blk" style={{ background: 'var(--lav)' }}>
              <h2>Focus for next week</h2>
              <p>{r.focusForNextWeek}</p>
            </div>
          </div>
        );
      }
      case 'writing':
        return <div className="report-card"><p>Writing your week's summary…</p></div>;
      case 'waiting':
        return <div className="report-card">{waitingLine(false)}</div>;
      case 'failed':
        return (
          <div className="report-card">
            <p>{view.row?.error?.endsWith('.') ? view.row.error : `Couldn't write this week's summary${view.row?.error ? `: ${view.row.error}` : '.'}`}</p>
            <div className="btn-row"><button className="btn" onClick={generate}>Retry</button></div>
          </div>
        );
      case 'download': {
        const w = view.writer;
        const missing = w.state === 'missing';
        const downloading = w.state === 'downloading' || w.state === 'verifying';
        return (
          <div className="report-card">
            <p>{missing ? `Download the writer (${sizeGb(w.sizeBytes)}) for a written week summary` : writerStatusText(w)}</p>
            <div className="btn-row">
              {missing && <button className="btn" onClick={download}>Download</button>}
              {downloading && <button className="btn s" onClick={cancelDownload}>Cancel download</button>}
              <button className="btn s" onClick={() => setShowCloud((v) => !v)}>Use cloud instead</button>
            </div>
            {downloading && <p className="report-note">Progress is kept, so Download picks up where it stopped.</p>}
            {showCloud && writer && <CloudSetup view={writer} onSaved={(v) => { setWriter(v); load(); }} />}
          </div>
        );
      }
      case 'cloud_offer': {
        const w = view.writer;
        return (
          <div className="report-card">
            {w.state === 'unavailable' && (
              <>
                <p>Can't write a week summary on this PC?</p>
                <p className="report-note">{w.text}</p>
                <p className="report-note">Use your own AI key:</p>
              </>
            )}
            {writer && <CloudSetup view={writer} onSaved={(v) => { setWriter(v); load(); }} />}
          </div>
        );
      }
      case 'notEnough':
        return <div className="report-card"><p>{view.nextWeek === null ? 'Not enough tracked days yet this week' : 'Not enough tracked days that week'}</p></div>;
      case 'generate':
        return (
          <div className="report-card">
            <p>{ready ? 'No summary yet for this week' : 'Your week summary is written after Sunday.'}</p>
            {ready && <div className="btn-row"><button className="btn" onClick={generate}>Generate</button></div>}
          </div>
        );
      default:
        return null;
    }
  };

  const screenDelta = deltaText(n.totals.screenSec, n.prev?.screenSec ?? null);
  const deepDelta = deltaText(n.totals.deepWorkSec, n.prev?.deepWorkSec ?? null);
  const maxScreen = Math.max(1, ...n.days.map((d) => d.screenSec));
  const maxHealth = 100;
  const canRegenerate = kind === 'summary' && !queued && view.writer.state === 'ready';
  const bestDay = n.bestFocusDay ? n.days.find((d) => d.date === n.bestFocusDay) : null;
  const topAppsMax = n.topApps[0]?.min ?? 0;

  // Health-score polyline, split into segments so a null (untracked) day breaks the line instead of joining across it.
  const healthPoints: ({ x: number; y: number } | null)[] = n.days.map((d, i) => (
    d.healthScore === null ? null : { x: ((i + 0.5) / 7) * 100, y: 100 - (d.healthScore / maxHealth) * 100 }
  ));
  const healthSegments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of healthPoints) {
    if (p === null) { if (current.length) { healthSegments.push(current); current = []; } }
    else current.push(p);
  }
  if (current.length) healthSegments.push(current);

  return (
    <>
      <main className="report">
        <div className="rhead">
          <button className="arrow" disabled={!view.prevWeek} aria-label="Previous week" onClick={() => setWeekStart(view.prevWeek)}>‹</button>
          <button className="arrow" disabled={!view.nextWeek} aria-label="Next week" onClick={() => setWeekStart(view.nextWeek)}>›</button>
          <span className="date">{weekLabel(view.weekStart, today)}</span>
          {canRegenerate && <button className="btn s" onClick={generate}>Regenerate</button>}
          {kind === 'summary' && (view.running
            ? <span className="report-note" role="status">Rewriting…</span>
            : !queued && view.row?.error && <span className="report-note" role="status">Couldn't regenerate: {view.row.error}</span>)}
        </div>
        {kind === 'summary' && queued && waitingLine(true)}

        {summaryCard()}

        <div className="stats">
          <div className="stat" style={{ animationDelay: '.1s' }}>
            <small>Screen time</small><b>{formatHm(n.totals.screenSec)}</b>
            {screenDelta && <em className={deltaClass(screenDelta)}>{screenDelta}</em>}
          </div>
          <div className="stat" style={{ animationDelay: '.16s' }}>
            <small>Deep work</small><b>{formatHm(n.totals.deepWorkSec)}</b>
            {deepDelta && <em className={deltaClass(deepDelta, true)}>{deepDelta}</em>}
          </div>
          <div className="stat" style={{ animationDelay: '.22s' }}><small>Average health score</small><b>{n.totals.avgHealth ?? '—'}</b></div>
          <div className="stat" style={{ animationDelay: '.28s' }}><small>Active days</small><b>{n.totals.activeDays} / 7</b></div>
          <div className="stat" style={{ animationDelay: '.34s' }}>
            <small>Pop-ups acted on</small><b>{n.nudges.acted}</b><em className="flat">{n.nudges.dismissed} dismissed</em>
          </div>
        </div>

        <section className="detail">
          <h2>Your week</h2>
          <div className="week-legend" aria-hidden="true">
            <span><i className="sw-bar" />Screen time</span>
            <span><i className="sw-line" />Health score (0–100)</span>
          </div>
          <div className="week-chart">
            {/* non-scaling-stroke keeps the line and dots even though the SVG stretches to the chart's width;
                a dot is a zero-length round-capped line, which stays round under that stretch too. */}
            <svg className="health-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {healthSegments.map((seg, i) => (
                <polyline key={i} points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ))}
              {healthSegments.flat().map((p, i) => (
                <polyline key={`d${i}`} points={`${p.x},${p.y} ${p.x},${p.y}`} stroke="var(--ink)" strokeWidth="8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <div className="bars">
              {n.days.map((d, i) => {
                const label = dayShortLabel(d.date, today);
                return (
                  <div key={d.date} className={`bar${d.date === today ? ' today' : ''}`} aria-label={`${label}: ${formatHm(d.screenSec)}${d.healthScore === null ? '' : `, health score ${d.healthScore}`}`}>
                    <div className="stack" style={{ height: `${d.screenSec > 0 ? Math.max(6, (d.screenSec / maxScreen) * 90) : 0}px`, animationDelay: `${0.3 + i * 0.08}s` }}>
                      {CATEGORIES.filter((c) => d.byCategory[c] > 0).map((c) => (
                        <div key={c} title={CATEGORY_LABEL[c]} style={{ height: `${(d.byCategory[c] / d.screenSec) * 100}%`, background: `var(--cat-${c})` }} />
                      ))}
                    </div>
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {bestDay && (
          <div className="report-card">
            <h2>Best focus day</h2>
            <p>{dayShortLabel(bestDay.date, today)} · {formatHm(bestDay.deepWorkSec)} of deep work</p>
          </div>
        )}

        {n.topApps.length > 0 && (
          <div className="box">
            <h3>Top apps <span>this week</span></h3>
            {n.topApps.map((a) => (
              <div className="app" key={a.app}>
                <AppBadge className="lg" name={a.app} />
                <div>{displayAppName(a.app)}<div className="tr"><div style={{ width: `${topAppsMax > 0 ? Math.round((a.min / topAppsMax) * 100) : 0}%` }} /></div></div>
                <em>{formatHm(a.min * 60)}</em>
              </div>
            ))}
          </div>
        )}
      </main>
      <aside className="panel" />
    </>
  );
}
