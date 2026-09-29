import { z } from 'zod';

export type PlanKind = 'focus_block' | 'app_cap' | 'break_interval' | 'wind_down';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = z.string().trim().min(1).transform((s) => s.slice(0, 160));
const planItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('focus_block'), text, payload: z.object({ start: z.string().regex(HHMM), minutes: z.number().int().min(15).max(240) }).strip() }).strip(),
  z.object({ kind: z.literal('app_cap'), text, payload: z.object({ app: z.string().trim().min(1).max(60), minutes: z.number().int().min(15).max(240) }).strip() }).strip(),
  z.object({ kind: z.literal('break_interval'), text, payload: z.object({ minutes: z.number().int().min(10).max(180) }).strip() }).strip(),
  z.object({ kind: z.literal('wind_down'), text, payload: z.object({ time: z.string().regex(HHMM) }).strip() }).strip()
]);
export type PlanItem = z.infer<typeof planItem>;
export interface ReportJson { headline: string; story: string; wins: string[]; habits: string[];
  doBetter: { candidateId: string; what: string; better: string }[]; plan: PlanItem[]; advice: string; }

const cut = (n: number) => (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown, max: number, len: number): string[] => list(v).slice(0, 20).map(cut(len)).filter(Boolean).slice(0, max);

export function parsePlanItem(raw: unknown): PlanItem | null {
  const r = planItem.safeParse(raw);
  return r.success ? r.data : null;
}

/** Validates the writer's answer item by item: bad items are dropped, over-long text is cut, only a missing headline fails. */
export function parseReport(raw: unknown, candidateIds: ReadonlySet<string>): ReportJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const headline = cut(80)(o.headline);
  if (!headline) return null;
  const doBetter = list(o.doBetter).slice(0, 20).flatMap((d) => {
    const x = (d ?? {}) as Record<string, unknown>;
    const id = typeof x.candidateId === 'string' ? x.candidateId : '';
    const what = cut(240)(x.what), better = cut(240)(x.better);
    return candidateIds.has(id) && what && better ? [{ candidateId: id, what, better }] : [];
  }).slice(0, 4);
  return {
    headline, story: cut(900)(o.story), wins: strings(o.wins, 3, 200), habits: strings(o.habits, 3, 200), doBetter,
    plan: list(o.plan).slice(0, 20).map(parsePlanItem).filter((p): p is PlanItem => p !== null).slice(0, 4), advice: cut(300)(o.advice)
  };
}

// The writer is told to use "you"/"your", but occasionally slips into first person. Rewrite conservatively, at word
// boundaries only, so we never mangle unrelated words ("meeting", "my_project").
const capitalizeLike = (original: string, lower: string): string =>
  (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
    ? lower[0].toUpperCase() + lower.slice(1) : lower);

function fixVoice(text: string): string {
  if (!text) return text;
  let out = text;
  // Sentence-start "I" / "I'm" / "I've" -> capitalized "You" forms (checked before the generic mid-sentence pass).
  out = out.replace(/(^|[.!?]\s+)I'm\b/g, (_m, p1: string) => `${p1}You're`);
  out = out.replace(/(^|[.!?]\s+)I've\b/g, (_m, p1: string) => `${p1}You've`);
  out = out.replace(/(^|[.!?]\s+)I\b/g, (_m, p1: string) => `${p1}You`);
  // Whatever "I" / "I'm" / "I've" is left is mid-sentence.
  out = out.replace(/\bI'm\b/g, "you're");
  out = out.replace(/\bI've\b/g, "you've");
  out = out.replace(/\bI\b/g, 'you');
  out = out.replace(/\bmyself\b/gi, (m) => capitalizeLike(m, 'yourself'));
  out = out.replace(/\bmy\b/gi, (m) => capitalizeLike(m, 'your'));
  out = out.replace(/\bme\b/gi, (m) => capitalizeLike(m, 'you'));
  return out;
}

/** Rewrites stray first-person pronouns to second person in a single free-text field. Exported so other writer
 * contracts (e.g. the weekly report) can reuse the same rewrite without going through the full ReportJson shape. */
export const normalizeVoiceText = fixVoice;

/** Rewrites stray first-person pronouns to second person in the free-text fields (never headline or plan, which
 * are short labels rather than prose). A safety net: the SYSTEM prompt already asks for "you" voice. */
export function normalizeVoice(report: ReportJson): ReportJson {
  return {
    ...report,
    story: normalizeVoiceText(report.story),
    wins: report.wins.map(normalizeVoiceText),
    habits: report.habits.map(normalizeVoiceText),
    advice: normalizeVoiceText(report.advice),
    doBetter: report.doBetter.map((d) => ({ ...d, what: normalizeVoiceText(d.what), better: normalizeVoiceText(d.better) }))
  };
}

// Matches a duration mention the writer might invent: "60 minutes", "45 min", "3 hours", "60-minute", "2h", "40m".
const DURATION_RE = /\b(\d+(?:\.\d+)?)\s*-?\s*(minutes|minute|mins|min|hours|hour|hrs|hr|h|m)\b/gi;
// The week prompt asks for "minutes, or Xh Ym" (report/week.ts), so the writer often states a combined duration
// like "5h 40m": matched (and consumed, below) as a single h*60+m value before the single-unit pass runs, so
// "5h" is never checked on its own (300) while the "40m" part goes ungrounded, or vice versa.
const COMBINED_DURATION_RE = /\b(\d+)\s*h(?:ours?|rs?)?\s*(?:and\s*)?(\d+)\s*m(?:in(?:ute)?s?)?\b/gi;
const toMinutes = (n: number, unit: string): number => (unit.toLowerCase().startsWith('h') ? n * 60 : n);

function hasUngroundedDuration(text: string, isGrounded: (mins: number) => boolean): boolean {
  COMBINED_DURATION_RE.lastIndex = 0;
  const spans: [number, number][] = [];
  let c: RegExpExecArray | null;
  while ((c = COMBINED_DURATION_RE.exec(text))) {
    if (!isGrounded(parseInt(c[1], 10) * 60 + parseInt(c[2], 10))) return true;
    spans.push([c.index, c.index + c[0].length]);
  }
  // Blank out (not remove: keeps offsets simple) each combined match before the single-unit pass, so its "Xh"
  // half is never re-checked on its own.
  let remaining = text;
  for (const [start, end] of spans) remaining = remaining.slice(0, start) + ' '.repeat(end - start) + remaining.slice(end);
  DURATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DURATION_RE.exec(remaining))) {
    if (!isGrounded(toMinutes(parseFloat(m[1]), m[2]))) return true;
  }
  return false;
}

/** Splits into sentences and keeps only those without an ungrounded duration mention (used for story/headline,
 * where a single bad number shouldn't lose the whole field). */
function dropUngroundedSentences(text: string, isGrounded: (mins: number) => boolean): string {
  if (!text) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.filter((s) => !hasUngroundedDuration(s, isGrounded)).join(' ').trim();
}

/** Removes any sentence in a single free-text field that mentions a duration/count not in `allowed` (±1 tolerance,
 * hour mentions compared as their minute equivalent). Exported so other writer contracts (e.g. the weekly report)
 * can reuse the same grounding rule without going through the full ReportJson shape. */
export function groundText(s: string, allowed: number[]): string {
  const isGrounded = (mins: number): boolean => allowed.some((a) => Math.abs(a - mins) <= 1);
  return dropUngroundedSentences(s, isGrounded);
}

/** Drops any invented duration/count the writer put in wins, habits, doBetter or advice (whole item dropped), and
 * removes just the offending sentence from story/headline (never invalidating the whole report over one bad line).
 * `allowed` are real minute values (facts, episode minutes, candidate text numbers); ±1 tolerance absorbs rounding,
 * and hour mentions ("1 hour", "2h") are compared as their minute equivalent. */
export function groundNumbers(report: ReportJson, allowed: number[]): ReportJson {
  const isGrounded = (mins: number): boolean => allowed.some((a) => Math.abs(a - mins) <= 1);
  const headline = groundText(report.headline, allowed) || 'Your day';
  const story = groundText(report.story, allowed);
  const wins = report.wins.filter((w) => !hasUngroundedDuration(w, isGrounded));
  const habits = report.habits.filter((h) => !hasUngroundedDuration(h, isGrounded));
  const doBetter = report.doBetter.filter((d) => !hasUngroundedDuration(d.what, isGrounded) && !hasUngroundedDuration(d.better, isGrounded));
  const advice = hasUngroundedDuration(report.advice, isGrounded) ? '' : report.advice;
  return { ...report, headline, story, wins, habits, doBetter, advice };
}

// Grammar for the local writer (node-llama-cpp createGrammarForJsonSchema), also spelled out in the system prompt.
// maxLength keeps generation from running away; parseReport still enforces every limit.
const str = (maxLength: number) => ({ type: 'string', maxLength }) as const;
export const REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: str(80), story: str(900),
    wins: { type: 'array', items: str(200), maxItems: 3 },
    habits: { type: 'array', items: str(200), maxItems: 3 },
    doBetter: { type: 'array', maxItems: 4, items: { type: 'object', properties: { candidateId: str(40), what: str(240), better: str(240) }, required: ['candidateId', 'what', 'better'] } },
    plan: { type: 'array', maxItems: 4, items: { type: 'object', properties: {
      text: str(160), kind: { enum: ['focus_block', 'app_cap', 'break_interval', 'wind_down'] },
      payload: { type: 'object', properties: { start: str(5), minutes: { type: 'integer' }, app: str(60), time: str(5) } } }, required: ['text', 'kind', 'payload'] } },
    advice: str(300)
  },
  required: ['headline', 'story', 'wins', 'habits', 'doBetter', 'plan', 'advice']
};
