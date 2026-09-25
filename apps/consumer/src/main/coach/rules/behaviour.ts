import type { Rule } from '../snapshot';
import type { RecentRead } from '../types';
import { displayAppName } from '../../../shared/categories';
import { CONFIDENT } from '../../brain/questions';
import { hm, switchesBetween } from '../activity';

const MIN = 60_000;
const FRESH_MS = 5 * MIN; // the latest scroll read must be this recent
const GAP_MS = 5 * MIN;   // reads further apart than this break a run
const DISTRACTED = 1.5, STUCK = 1.5;

function matchDistraction(r: RecentRead, list: string[]): string | null {
  const hay = `${r.appName} ${r.windowTitle ?? ''}`.toLowerCase();
  return list.find((d) => hay.includes(d.toLowerCase())) ?? null;
}

export const doomscroll: Rule = (s) => {
  const byApp = new Map<string, RecentRead[]>();
  for (const r of s.readsToday) byApp.set(r.appName, [...(byApp.get(r.appName) ?? []), r]);
  for (const [app, reads] of byApp) {
    const last = reads[reads.length - 1];
    if (s.now - last.at > FRESH_MS || (last.distraction ?? 0) < DISTRACTED) continue;
    let first = last;
    for (let i = reads.length - 2; i >= 0; i--) {
      const r = reads[i];
      if ((r.distraction ?? 0) < DISTRACTED || first.at - r.at > GAP_MS) break;
      first = r;
    }
    const named = matchDistraction(last, s.profile.distractions);
    const needMin = named ? 15 : 20;
    const mins = Math.round((last.at - first.at) / MIN);
    if (mins < needMin) continue;
    const label = named ?? displayAppName(app);
    return { ruleId: 'doomscroll', kind: 'behaviour', key: `doomscroll:${app}:${first.at}`, mini: 'Scrolling', stat: `${mins} min`,
      title: `You've been scrolling ${label} ${mins} min`, body: 'Take a short break? A minute away resets the pull.',
      primary: { label: 'Take a break', action: 'break_eye' } };
  }
  return null;
};

export const scattered: Rule = (s) => {
  const n = switchesBetween(s.sessions, s.now - 15 * MIN, s.now);
  if (n < 40) return null;
  return { ruleId: 'scattered', kind: 'behaviour', key: `scattered:${Math.floor(s.now / (15 * MIN))}`, mini: 'Scattered?', stat: `${n} switches`,
    title: 'Feeling scattered?', body: `${n} app switches in 15 min. Pick one task and close the rest for a while.`, primary: { label: 'OK', action: 'ack' } };
};

export const stuckEscape: Rule = (s) => {
  const escapes = new Map<string, number>();
  let count = 0;
  s.readsToday.forEach((r, i) => {
    if ((r.stuck ?? 0) < STUCK) return;
    const next = s.readsToday.slice(i + 1).find((x) => x.at - r.at <= 2 * MIN && (x.category === 'social' || x.category === 'entertainment') && (x.conf ?? 0) >= CONFIDENT);
    if (!next) return;
    count++;
    escapes.set(next.appName, (escapes.get(next.appName) ?? 0) + 1);
  });
  if (count < 3) return null;
  const app = displayAppName([...escapes.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return { ruleId: 'stuck_escape', kind: 'behaviour', key: `stuck_escape:${s.date}`, mini: 'Reflex', stat: `${count}× today`,
    title: `Stuck → ${app} is becoming a reflex`, body: `${count} times today you went to ${app} right after getting stuck. Try a 2-minute walk instead.`,
    primary: { label: 'OK', action: 'ack' } };
};

export const appCap: Rule = (s) => {
  for (const l of s.limits) {
    const used = s.view.apps.find((a) => displayAppName(a.appName).toLowerCase() === l.app.toLowerCase());
    if (!used || used.seconds < l.minutes * 60) continue;
    return { ruleId: 'app_cap', kind: 'behaviour', key: `app_cap:${l.app}:${s.date}`, mini: `${l.app} limit`, stat: hm(l.minutes),
      title: `${l.app}: ${hm(l.minutes)} limit reached`, body: `You've used ${l.app} for ${hm(Math.round(used.seconds / 60))} today. Time to close it?`,
      primary: { label: 'OK', action: 'ack' } };
  }
  return null;
};
