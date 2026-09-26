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
const strings = (v: unknown, max: number, len: number): string[] => list(v).slice(0, max).map(cut(len)).filter(Boolean);

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

// Grammar for the local writer (node-llama-cpp createGrammarForJsonSchema). Lengths are enforced by parseReport.
const str = { type: 'string' } as const;
export const REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: str, story: str,
    wins: { type: 'array', items: str, maxItems: 3 },
    habits: { type: 'array', items: str, maxItems: 3 },
    doBetter: { type: 'array', maxItems: 4, items: { type: 'object', properties: { candidateId: str, what: str, better: str }, required: ['candidateId', 'what', 'better'] } },
    plan: { type: 'array', maxItems: 4, items: { type: 'object', properties: {
      text: str, kind: { enum: ['focus_block', 'app_cap', 'break_interval', 'wind_down'] },
      payload: { type: 'object', properties: { start: str, minutes: { type: 'integer' }, app: str, time: str } } }, required: ['text', 'kind', 'payload'] } },
    advice: str
  },
  required: ['headline', 'story', 'wins', 'habits', 'doBetter', 'plan', 'advice']
};
