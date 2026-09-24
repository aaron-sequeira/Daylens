import { displayAppName } from '../../shared/categories';

export function formatHm(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function hourLabel(h: number): string {
  const hh = h % 24;
  return `${((hh + 11) % 12) + 1} ${hh < 12 ? 'am' : 'pm'}`;
}

export function appInitials(appName: string): string {
  return displayAppName(appName).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function appColor(appName: string): string {
  let h = 0;
  for (const c of appName) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 52%)`;
}

export function joinApps(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function healthLabel(score: number): string {
  return score >= 75 ? 'Pretty healthy' : score >= 50 ? 'Could use a break' : 'Rough day';
}
