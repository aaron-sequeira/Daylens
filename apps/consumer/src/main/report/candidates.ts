import { displayAppName } from '../../shared/categories';
import type { Episode } from './episodes';

const MAX_STUCK = 5;
const MAX_OTHER = 3; // searches, pop-ups and limits each
const TITLE_CHARS = 80;

export interface ReportCandidate { id: string; kind: 'stuck' | 'search' | 'nudge' | 'cap'; text: string; sample?: string; }

export function buildCandidates(i: { episodes: Episode[]; searches: { query: string; count: number }[];
  nudges: { id: number; ruleId: string; title: string; status: string }[]; caps: { app: string; minutes: number; usedMin: number; usedMs: number }[] }): ReportCandidate[] {
  const out: ReportCandidate[] = [];
  // Capped per kind to keep the writer's input small; the most stuck episodes first.
  const stuck = i.episodes.filter((e) => e.avgStuck >= 1.5 || e.stuckReads >= 3)
    .sort((a, b) => b.avgStuck - a.avgStuck || b.stuckReads - a.stuckReads).slice(0, MAX_STUCK);
  for (const e of stuck) {
    const min = Math.round((e.end - e.start) / 60_000);
    const title = e.titles[0]?.slice(0, TITLE_CHARS);
    out.push({ id: `stuck:${e.id}`, kind: 'stuck', text: `Stuck for ${min} min in ${displayAppName(e.app)}${title ? ` (${title})` : ''}`,
      ...(e.samples[0] ? { sample: e.samples[0].slice(0, 200) } : {}) });
  }
  i.searches.slice(0, MAX_OTHER).forEach((s, n) => out.push({ id: `search:${n}`, kind: 'search', text: `Searched "${s.query}" ${s.count} times this week` }));
  // Reminders (water/lunch/etc.) are routine, not noteworthy behaviour: they never enter the report.
  for (const n of i.nudges.filter((x) => x.ruleId !== 'reminder').slice(0, MAX_OTHER)) out.push({ id: `nudge:${n.id}`, kind: 'nudge', text: `Pop-up "${n.title}" (${n.status})` });
  // Same test as the app_cap pop-up (unrounded), so the report never claims a limit the pop-up didn't.
  for (const c of i.caps.filter((x) => x.usedMs >= x.minutes * 60_000).slice(0, MAX_OTHER)) {
    out.push({ id: `cap:${c.app}`, kind: 'cap', text: `${c.app}: ${c.usedMin} min used, limit ${c.minutes} min` });
  }
  return out;
}
