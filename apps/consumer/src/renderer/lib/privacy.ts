import { DEFAULT_EXCLUSIONS, MAX_EXCLUSIONS } from '../../shared/exclusions';

/** Union of the current list and the defaults (case-insensitive), capped at MAX_EXCLUSIONS. Keeps whatever the user
 * added, never dropping their patterns; `full` = some default couldn't be added because the list is at the cap. */
export function restoreDefaults(current: string[]): { list: string[]; full: boolean } {
  const seen = new Set(current.map((p) => p.toLowerCase()));
  const list = [...current];
  let full = false;
  for (const d of DEFAULT_EXCLUSIONS) {
    if (seen.has(d.toLowerCase())) continue;
    if (list.length >= MAX_EXCLUSIONS) { full = true; break; }
    seen.add(d.toLowerCase());
    list.push(d);
  }
  return { list, full };
}
