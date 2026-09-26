import { displayAppName } from '../../shared/categories';
import type { Episode } from './episodes';

export interface ReportCandidate { id: string; kind: 'stuck' | 'search' | 'nudge' | 'cap'; text: string; sample?: string; }

export function buildCandidates(i: { episodes: Episode[]; searches: { query: string; count: number }[];
  nudges: { id: number; ruleId: string; title: string; status: string }[]; caps: { app: string; minutes: number; usedMin: number; usedMs: number }[] }): ReportCandidate[] {
  const out: ReportCandidate[] = [];
  for (const e of i.episodes) {
    if (e.avgStuck < 1.5 && e.stuckReads < 3) continue;
    const min = Math.round((e.end - e.start) / 60_000);
    out.push({ id: `stuck:${e.id}`, kind: 'stuck', text: `Stuck for ${min} min in ${displayAppName(e.app)}${e.titles[0] ? ` (${e.titles[0]})` : ''}`,
      ...(e.samples[0] ? { sample: e.samples[0].slice(0, 200) } : {}) });
  }
  i.searches.forEach((s, n) => out.push({ id: `search:${n}`, kind: 'search', text: `Searched "${s.query}" ${s.count} times this week` }));
  for (const n of i.nudges) out.push({ id: `nudge:${n.id}`, kind: 'nudge', text: `Pop-up "${n.title}" (${n.status})` });
  // Same test as the app_cap pop-up (unrounded), so the report never claims a limit the pop-up didn't.
  for (const c of i.caps) if (c.usedMs >= c.minutes * 60_000) out.push({ id: `cap:${c.app}`, kind: 'cap', text: `${c.app}: ${c.usedMin} min used, limit ${c.minutes} min` });
  return out;
}
