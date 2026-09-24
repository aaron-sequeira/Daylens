import { z } from 'zod';
import type { DaylensSettings } from './settings';
import { DEFAULT_PROFILE, GOALS, MAX_DISTRACTIONS, MAX_TEXT, ROLES, type Goal, type Profile, type Role } from '../shared/profileOptions';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const clean = (s: string): string => s.trim().replace(/\s+/g, ' ');
const text = (min: number) =>
  z.string().refine((s) => !CONTROL.test(s), 'control characters').transform(clean).pipe(z.string().min(min).max(MAX_TEXT));
const unique = <T>(a: T[]): boolean => new Set(a).size === a.length;

/** IPC trust boundary for profile:save. */
export const profileInput = z.object({
  name: text(0),
  roles: z.array(z.enum(ROLES)).refine(unique, 'duplicate role'),
  goals: z.array(z.enum(GOALS)).refine(unique, 'duplicate goal'),
  start: z.string().regex(TIME),
  bed: z.string().regex(TIME),
  days: z.array(z.number().int().min(1).max(7)).refine(unique, 'duplicate day'),
  distractions: z.array(text(1)).max(MAX_DISTRACTIONS).refine((a) => unique(a.map((s) => s.toLowerCase())), 'duplicate distraction')
}).strict();

export function toSettingsPatch(p: Profile): Partial<DaylensSettings> {
  return {
    profileName: p.name,
    profileRoles: JSON.stringify(p.roles),
    profileGoals: JSON.stringify(p.goals),
    profileStart: p.start,
    profileDays: JSON.stringify([...p.days].sort((a, b) => a - b)),
    profileDistractions: JSON.stringify(p.distractions),
    windDownTime: p.bed
  };
}

function parseList<T>(raw: string, keep: (v: unknown) => v is T, fallback: T[]): T[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter(keep))] : fallback;
  } catch {
    return fallback;
  }
}

/** Typed profile from stored settings; anything corrupt or unknown falls back to defaults (never throws). */
export function readProfile(s: DaylensSettings): Profile {
  const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v);
  const isGoal = (v: unknown): v is Goal => (GOALS as readonly unknown[]).includes(v);
  const isDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 7;
  const isApp = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT && !CONTROL.test(v);
  return {
    name: clean(s.profileName).slice(0, MAX_TEXT),
    roles: parseList(s.profileRoles, isRole, []),
    goals: parseList(s.profileGoals, isGoal, []),
    start: TIME.test(s.profileStart) ? s.profileStart : DEFAULT_PROFILE.start,
    bed: TIME.test(s.windDownTime) ? s.windDownTime : DEFAULT_PROFILE.bed,
    days: parseList(s.profileDays, isDay, DEFAULT_PROFILE.days).sort((a, b) => a - b),
    distractions: parseList(s.profileDistractions, isApp, []).slice(0, MAX_DISTRACTIONS)
  };
}
