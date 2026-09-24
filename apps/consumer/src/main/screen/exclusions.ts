import { z } from 'zod';
import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS, MAX_PATTERN, cleanPattern } from '../../shared/exclusions';

const CONTROL = /[\u0000-\u001f\u007f]/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match that also works for patterns starting/ending with symbols ("C++", "1Password").
const matcher = (p: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu');

export function isExcluded(patterns: string[], appName: string, title: string | null): boolean {
  return patterns.some((p) => {
    const re = matcher(p);
    return re.test(appName) || (title !== null && re.test(title));
  });
}

/** Stored JSON → list; anything that isn't a JSON array falls back to the defaults. Invalid entries are dropped. */
export function parseExclusions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [...DEFAULT_EXCLUSIONS];
    return v.filter((p): p is string => typeof p === 'string' && !CONTROL.test(p) && cleanPattern(p).length > 0 && p.length <= MAX_PATTERN)
      .map(cleanPattern).slice(0, MAX_EXCLUSIONS);
  } catch {
    return [...DEFAULT_EXCLUSIONS];
  }
}

/** IPC trust boundary for privacy:setExclusions. */
export const exclusionsInput = z.array(
  z.string().refine((s) => !CONTROL.test(s), 'control characters').transform(cleanPattern).pipe(z.string().min(1).max(MAX_PATTERN))
).max(MAX_EXCLUSIONS).refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, 'duplicate pattern');
