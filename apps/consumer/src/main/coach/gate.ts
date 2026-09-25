import type { Candidate, Kind, NudgeRow, NudgeStatus } from './types';

export const GLOBAL_COOLDOWN_MS = 20 * 60_000;
export const RULE_COOLDOWN_MS = 2 * 3_600_000;
const OWN_CADENCE = new Set(['eye_break', 'stretch']);
const DISPLAYED = new Set<NudgeStatus>(['shown', 'dismissed', 'acted', 'snoozed', 'expired']);

export interface GateContext { now: number; history: NudgeRow[]; kinds: Record<Kind, boolean>; snoozeUntil: number; fewer: Partial<Record<Kind, number>>; weight: number; hold: string | null; }
export type Decision = { status: 'show'; offerFewer: boolean } | { status: 'held'; reason: string } | { status: 'drop'; reason: string };

/** `history` = the last 7 days of nudges. Drops leave no record, so the rule can fire later. */
export function decide(c: Candidate, x: GateContext): Decision {
  if (x.history.some((n) => n.key === c.key)) return { status: 'drop', reason: 'already fired' };
  if (!x.kinds[c.kind]) return { status: 'drop', reason: 'kind off' };
  const shown = x.history.filter((n) => DISPLAYED.has(n.status));
  const dismissals = x.history.filter((n) => n.kind === c.kind && n.status === 'dismissed').length;
  const backoff = (dismissals >= 3 ? 2 : 1) * (x.fewer[c.kind] ?? 1);
  if (!OWN_CADENCE.has(c.ruleId)) {
    if (shown.some((n) => !OWN_CADENCE.has(n.ruleId) && x.now - n.at < GLOBAL_COOLDOWN_MS)) return { status: 'drop', reason: 'global cooldown' };
    if (shown.some((n) => n.ruleId === c.ruleId && x.now - n.at < RULE_COOLDOWN_MS * x.weight * backoff)) return { status: 'drop', reason: 'rule cooldown' };
  }
  if (x.now < x.snoozeUntil) return { status: 'held', reason: 'snoozed' };
  if (x.hold) return { status: 'held', reason: x.hold };
  return { status: 'show', offerFewer: dismissals >= 3 };
}

export interface Rect { x: number; y: number; width: number; height: number; }
const SILENT_STATES = new Set([2, 3, 4, 6]); // busy, D3D full screen, presentation mode, quiet time
const near = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;

function isCall(appName: string, title: string): boolean {
  if (/^zoom/i.test(appName) || /zoom meeting/i.test(title)) return true;
  if (/teams/i.test(appName) && /(meeting|call)/i.test(title)) return true;
  if (/meet - /i.test(title)) return true;
  return /discord/i.test(appName) && /voice connected/i.test(title);
}

export function holdReason(fg: { appName: string; title: string | null; bounds: Rect | null } | null, displays: Rect[], notifState: number | null): string | null {
  if (notifState !== null && SILENT_STATES.has(notifState)) return 'focus-assist';
  if (!fg) return null;
  const desktop = /explorer/i.test(fg.appName) && (fg.title ?? '') === 'Program Manager';
  if (!desktop && fg.bounds && displays.some((d) => near(d, fg.bounds as Rect))) return 'fullscreen';
  return isCall(fg.appName, fg.title ?? '') ? 'call' : null;
}
