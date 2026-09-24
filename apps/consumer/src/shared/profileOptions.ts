// Browser-safe profile vocabulary shared by main (validation) and renderer (onboarding UI).
export const ROLES = ['student', 'dev', 'design', 'office', 'create', 'game', 'browse'] as const;
export const GOALS = ['less', 'focus', 'sleep', 'breaks', 'distract', 'better'] as const;
export type Role = typeof ROLES[number];
export type Goal = typeof GOALS[number];

export interface Profile {
  name: string;
  roles: Role[];
  goals: Goal[];
  start: string; // HH:MM
  bed: string; // HH:MM, stored as windDownTime
  days: number[]; // 1 = Monday … 7 = Sunday
  distractions: string[];
}

export const DEFAULT_PROFILE: Profile = { name: '', roles: [], goals: [], start: '09:00', bed: '23:00', days: [1, 2, 3, 4, 5], distractions: [] };
export const MAX_DISTRACTIONS = 12;
export const MAX_TEXT = 40;
