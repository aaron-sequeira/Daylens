// Browser-safe exclusion list helpers (renderer edits the list; main validates and matches).
export const DEFAULT_EXCLUSIONS: string[] = [
  '1Password', 'Bitwarden', 'KeePass', 'KeePassXC', 'LastPass', 'Dashlane', 'Windows Security', 'Credential Manager',
  'InPrivate', 'Incognito', 'Private Browsing', 'bank', 'banking', 'PayPal', 'password'
];
export const MAX_EXCLUSIONS = 40;
export const MAX_PATTERN = 60;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const cleanPattern = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

/** Returns the list with `raw` added, or the same list when it is empty, too long, invalid, duplicate or the list is full. */
export function addExclusion(list: string[], raw: string): string[] {
  if (CONTROL.test(raw)) return list;
  const v = cleanPattern(raw);
  if (!v || v.length > MAX_PATTERN || list.length >= MAX_EXCLUSIONS) return list;
  if (list.some((p) => p.toLowerCase() === v.toLowerCase())) return list;
  return [...list, v];
}
