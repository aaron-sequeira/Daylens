import { z } from 'zod';
import { KINDS, type AppLimit, type Kind } from './types';

export const MAX_LIMITS = 20;
const CONTROL = /[\u0000-\u001f\u007f]/;
const safe = <T>(json: string, fallback: T): unknown => { try { return JSON.parse(json) as unknown; } catch { return fallback; } };

export function parseKinds(json: string): Record<Kind, boolean> {
  const v = safe(json, {}) as Record<string, unknown> | null;
  return Object.fromEntries(KINDS.map((k) => [k, v && typeof v === 'object' && typeof v[k] === 'boolean' ? (v[k] as boolean) : true])) as Record<Kind, boolean>;
}

const limit = z.object({ app: z.string().trim().min(1).max(60).refine((s) => !CONTROL.test(s)), minutes: z.number().int().min(15).max(240) }).strict();
export const limitsInput = z.array(limit).max(MAX_LIMITS);

export function parseLimits(json: string): AppLimit[] {
  const v = safe(json, []);
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => { const r = limit.safeParse(x); return r.success ? [r.data] : []; }).slice(0, MAX_LIMITS);
}

export function parseFewer(json: string): Partial<Record<Kind, number>> {
  const v = safe(json, {}) as Record<string, unknown> | null;
  const out: Partial<Record<Kind, number>> = {};
  for (const k of KINDS) { const m = v && typeof v === 'object' ? v[k] : undefined; if (typeof m === 'number' && m >= 1 && m <= 64) out[k] = m; }
  return out;
}

export const kindsInput = z.object({ health: z.boolean(), behaviour: z.boolean(), tip: z.boolean(), win: z.boolean() }).strict();
export const snoozeInput = z.enum(['1h', 'tomorrow', 'off']);

/** A kind switched from off to on starts fresh: its "show fewer" multiplier is dropped. */
export function resetFewerOnEnable(prev: Record<Kind, boolean>, next: Record<Kind, boolean>, fewer: Partial<Record<Kind, number>>): Partial<Record<Kind, number>> {
  const out = { ...fewer };
  for (const k of KINDS) if (!prev[k] && next[k]) delete out[k];
  return out;
}
