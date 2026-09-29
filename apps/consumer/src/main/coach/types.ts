export type Kind = 'health' | 'behaviour' | 'tip' | 'win' | 'reminder';
export const KINDS: readonly Kind[] = ['health', 'behaviour', 'tip', 'win', 'reminder'];
export type NudgeStatus = 'shown' | 'held' | 'dismissed' | 'acted' | 'snoozed' | 'expired';
export type PrimaryAction = 'break_eye' | 'break_stretch' | 'break_reminder' | 'reminder_done' | 'ack';
export interface Candidate { ruleId: string; kind: Kind; key: string; mini: string; stat: string; title: string; body: string; primary: { label: string; action: PrimaryAction }; /** eye_break/stretch: per-rule gap at weight 1 (just under the rule's own cadence). */ gapMs?: number; reminderId?: number; secondary?: { label: string }; }
export interface NudgeRow { id: number; at: number; date: string; kind: Kind; ruleId: string; key: string; title: string; body: string; status: NudgeStatus; }
export interface RecentRead { at: number; appName: string; windowTitle: string | null; category: string | null; conf: number | null; stuck: number | null; distraction: number | null; }
export interface AppLimit { app: string; minutes: number; }
export interface PillNudge { id: number; kind: Kind; mini: string; stat: string; title: string; body: string; primaryLabel: string; offerFewer: boolean; secondaryLabel?: string; }
export type PillAction = 'primary' | 'secondary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';
