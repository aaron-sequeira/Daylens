import type { Rule } from '../snapshot';
import { hm, switchesBetween } from '../activity';

const MIN = 60_000;

export const deepWork: Rule = (s) => {
  const segs = [...s.view.timeline].sort((a, b) => a.start - b.start);
  let run: { start: number; end: number } | null = null;
  for (const g of segs) {
    const focus = g.category === 'work' || g.category === 'learning';
    if (!focus) { run = null; continue; }
    run = run && g.start - run.end <= MIN ? { start: run.start, end: Math.max(run.end, g.end) } : { start: g.start, end: g.end };
  }
  if (!run || s.now - run.end > 2 * MIN) return null;
  const mins = Math.round((run.end - run.start) / MIN);
  const milestone = mins >= 90 ? 90 : mins >= 60 ? 60 : 0;
  if (!milestone) return null;
  if (switchesBetween(s.sessions, run.start, run.end) > 10) return null;
  const d = s.readsToday.filter((r) => r.at >= run!.start && r.at <= run!.end && r.distraction !== null).map((r) => r.distraction as number);
  if (d.length && d.reduce((a, b) => a + b, 0) / d.length >= 0.5) return null;
  return { ruleId: 'deep_work', kind: 'win', key: `deep_work:${run.start}:${milestone}`, mini: 'Deep work', stat: `${milestone} min 🎉`,
    title: `${milestone}-min deep-work streak 🎉`, body: 'Nice focus. Stand up, stretch, grab some water.', primary: { label: 'Keep going', action: 'ack' } };
};

export const belowAvg: Rule = (s) => {
  if (new Date(s.now).getHours() < 18) return null;
  const prior = s.view.week.slice(0, -1).filter((d) => d.seconds > 0);
  if (prior.length < 3) return null;
  const avg = prior.reduce((a, d) => a + d.seconds, 0) / prior.length;
  if (s.view.screenSec >= avg * 0.9) return null;
  const p = Math.round((1 - s.view.screenSec / avg) * 100);
  return { ruleId: 'below_avg', kind: 'win', key: `below_avg:${s.date}`, mini: 'Below average', stat: `-${p}%`,
    title: `Down ${p}% today`, body: `${hm(Math.round(s.view.screenSec / 60))} so far vs your ${hm(Math.round(avg / 60))} average. Keep it up.`,
    primary: { label: '🎉', action: 'ack' } };
};
