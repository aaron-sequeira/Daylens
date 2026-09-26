import { formatClock } from './format';

export const LIMIT_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240];

export function snoozeText(snoozeUntil: number, now: number): string {
  return snoozeUntil > now ? `Snoozed until ${formatClock(snoozeUntil)}` : 'Pop-ups are on';
}

// Onboarding categories no app name or window title contains, so a limit on them could never fire.
const UNMATCHABLE = new Set(['games', 'news']);

export function limitSuggestions(distractions: string[], existing: { app: string }[]): string[] {
  const have = new Set(existing.map((l) => l.app.toLowerCase()));
  return distractions.filter((d) => !have.has(d.toLowerCase()) && !UNMATCHABLE.has(d.toLowerCase()));
}

export function addLimit(list: { app: string; minutes: number }[], raw: string, minutes: number): { app: string; minutes: number }[] {
  const app = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (!app || app.length > 60 || list.length >= 20 || list.some((l) => l.app.toLowerCase() === app.toLowerCase())) return list;
  return [...list, { app, minutes }];
}
