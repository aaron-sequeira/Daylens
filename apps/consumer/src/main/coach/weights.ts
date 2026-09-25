import type { Goal, Profile } from '../../shared/profileOptions';
import type { Kind } from './types';

const GOAL_RULES: Record<Goal, string[]> = {
  less: ['goal_80', 'goal_100', 'below_avg'], focus: ['scattered', 'deep_work'], sleep: ['wind_down'],
  breaks: ['eye_break', 'stretch'], distract: ['doomscroll', 'stuck_escape', 'app_cap', 'stuck_tip'], better: []
};

/** Cooldown multiplier: rules for goals the user picked run at normal pace, others half as often. */
export function ruleWeight(ruleId: string, kind: Kind, profile: Profile, now: number): number {
  let w = 1;
  if (profile.goals.length && !profile.goals.includes('better') && ruleId !== 'repeat_search') {
    if (!profile.goals.flatMap((g) => GOAL_RULES[g]).includes(ruleId)) w *= 2;
  }
  const dow = ((new Date(now).getDay() + 6) % 7) + 1; // 1 = Monday
  if (kind === 'behaviour' && !profile.days.includes(dow)) w *= 2;
  return w;
}
