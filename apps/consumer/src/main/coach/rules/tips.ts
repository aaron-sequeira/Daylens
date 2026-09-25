import type { Rule } from '../snapshot';
import { displayAppName } from '../../../shared/categories';
import { normaliseSearch } from '../activity';

const MIN = 60_000;

// ponytail: template text; Phase 6's writer replaces title/body behind the same Candidate shape.
export const stuckTip: Rule = (s) => {
  const recent = s.readsToday.filter((r) => s.now - r.at <= 10 * MIN && (r.stuck ?? 0) >= 1.5);
  const byApp = new Map<string, number>();
  for (const r of recent) byApp.set(r.appName, (byApp.get(r.appName) ?? 0) + 1);
  const hit = [...byApp.entries()].find(([, n]) => n >= 3);
  if (!hit) return null;
  const app = displayAppName(hit[0]);
  return { ruleId: 'stuck_tip', kind: 'tip', key: `stuck_tip:${hit[0]}:${Math.floor(s.now / (2 * 60 * MIN))}`, mini: 'Stuck?', stat: '10 min',
    title: `Stuck in ${app}?`, body: 'Ten minutes on the same problem. Try explaining it out loud, or take a 5-min walk and come back.',
    primary: { label: 'Got it', action: 'ack' } };
};

export const repeatSearch: Rule = (s) => {
  const counts = new Map<string, number>();
  for (const t of s.searchTitles) { const q = normaliseSearch(t.title); if (q) counts.set(q, (counts.get(q) ?? 0) + 1); }
  const hit = [...counts.entries()].find(([, n]) => n >= 3);
  if (!hit) return null;
  const q = hit[0].length > 30 ? `${hit[0].slice(0, 29)}…` : hit[0];
  return { ruleId: 'repeat_search', kind: 'tip', key: `repeat_search:${hit[0]}`, mini: 'Same search', stat: `${hit[1]}×`,
    title: `Searched "${q}" ${hit[1]}× this week`, body: "Save the answer as a note or bookmark so you don't have to look it up again.",
    primary: { label: 'Got it', action: 'ack' } };
};
