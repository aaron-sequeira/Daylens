import type { Rule } from '../snapshot';

const WINDOW_MS = 5 * 60_000;
export const focusStart: Rule = (s) => {
  const b = s.focusBlocks.find((x) => s.now >= x.start && s.now < x.start + WINDOW_MS);
  if (!b) return null;
  return { ruleId: 'focus_start', kind: 'tip', key: `focus_start:${s.date}:${b.label}`, mini: 'Focus block', stat: `${b.minutes} min`,
    title: 'Your focus block starts now', body: `You planned ${b.minutes} min of focus. Close what you don't need; pop-ups stay quiet until it ends.`,
    primary: { label: 'Start', action: 'ack' } };
};
