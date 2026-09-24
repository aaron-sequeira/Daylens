export const MAX_READ_TEXT = 4000;

// Order matters: emails and structured secrets first, generic runs last.
const RULES: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, '[secret]'],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/g, '[secret]'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[secret]'],
  // base64-like: 32+ chars that contain both a letter and a digit (so long plain words survive)
  [/(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g, '[secret]'],
  // ponytail: 8+ digits with single spaces/dashes — also catches ISO dates (2026-09-24); acceptable loss for now.
  [/\d(?:[ -]?\d){7,}/g, '[number]']
];

export function redact(text: string): string {
  let t = text;
  for (const [re, rep] of RULES) t = t.replace(re, rep);
  return t.slice(0, MAX_READ_TEXT);
}
