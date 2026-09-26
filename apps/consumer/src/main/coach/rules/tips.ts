import type { Rule } from '../snapshot';
import { displayAppName } from '../../../shared/categories';
import { repeatedSearches, stillIn } from '../activity';

const MIN = 60_000;
const SPAN_MS = 10 * MIN;  // 3 stuck reads within this span of each other
const FRESH_MS = 30 * MIN; // spec §4.2: labels may arrive up to 30 min after the read

/** True when some 3 consecutive stuck reads fall within SPAN_MS and the latest of them is fresh. */
function stuckRun(times: number[], now: number): boolean {
  for (let i = 2; i < times.length; i++) if (times[i] - times[i - 2] <= SPAN_MS && now - times[i] <= FRESH_MS) return true;
  return false;
}

// ponytail: template text; Phase 6's writer replaces title/body behind the same Candidate shape.
export const stuckTip: Rule = (s) => {
  const byApp = new Map<string, number[]>();
  for (const r of s.readsToday) {
    if ((r.stuck ?? 0) < 1.5) continue;
    byApp.set(r.appName, [...(byApp.get(r.appName) ?? []), r.at]);
  }
  const hit = [...byApp.entries()].find(([a, times]) => stuckRun(times.sort((x, y) => x - y), s.now) && stillIn(s.sessions, a));
  if (!hit) return null;
  const app = displayAppName(hit[0]);
  return { ruleId: 'stuck_tip', kind: 'tip', key: `stuck_tip:${hit[0]}:${Math.floor(s.now / (2 * 60 * MIN))}`, mini: 'Stuck?', stat: 'stuck',
    title: `Stuck in ${app}?`, body: 'Looks like you have been stuck on the same thing for a while. Try explaining it out loud, or take a 5-min walk and come back.',
    primary: { label: 'Got it', action: 'ack' } };
};

export const repeatSearch: Rule = (s) => {
  const hit = repeatedSearches(s.searchTitles)[0];
  if (!hit) return null;
  const q = hit.query.length > 30 ? `${hit.query.slice(0, 29)}…` : hit.query;
  return { ruleId: 'repeat_search', kind: 'tip', key: `repeat_search:${hit.query}`, mini: 'Same search', stat: `${hit.count}×`,
    title: `Searched "${q}" ${hit.count}× this week`, body: "Save the answer as a note or bookmark so you don't have to look it up again.",
    primary: { label: 'Got it', action: 'ack' } };
};
