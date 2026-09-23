// TypeScript port of Laya's reference inference (convaiinnovations/laya rl_common.py + rl_agent_api.py).
// Sequence layout and post-processing must stay byte-for-byte compatible with the Python code:
// laya.parity.test.ts checks it against tools/laya/{sequences,golden}.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LayaQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> | string[] }
  | { type: 'score'; instructions: string; criteria: string[] };

export type LayaAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

export interface LayaMeta {
  max_len: number; head_max_len: number;
  temperature: number[]; temperature_by_options: Record<string, number>;
  cls_id: number; sep_id: number; mask_id: number; pad_id: number; mask_token: string;
}

export interface TokenEncoder { encode(text: string): number[] }

const QTYPE = { choice: 0, score: 1 } as const;
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function choiceCriteria(q: Extract<LayaQuestion, { type: 'choice' }>): Record<string, string | null> {
  return Array.isArray(q.criteria) ? Object.fromEntries(q.criteria.map((c) => [c, null])) : q.criteria;
}

export function renderOptions(q: LayaQuestion): string[] {
  if (q.type === 'choice') return Object.entries(choiceCriteria(q)).map(([k, v]) => (v ? `${k}: ${v}` : k));
  return q.criteria.map((c, i) => `level ${i}: ${c}`);
}

function optionKeys(q: LayaQuestion): string[] {
  return q.type === 'choice' ? Object.keys(choiceCriteria(q)) : q.criteria.map((_, i) => String(i));
}

export function buildSequence(enc: TokenEncoder, meta: LayaMeta, state: string, q: LayaQuestion): { ids: number[]; markers: number[] } {
  const strip = (s: string): string => s.split(meta.mask_token).join(' ');
  let headIds = enc.encode(`${q.type} question: ${strip(q.instructions)}`);
  let optIds = renderOptions(q).map((o) => [meta.mask_id, ...enc.encode(' ' + strip(o)).slice(0, 48)]);
  const used = (): number => optIds.reduce((a, o) => a + o.length, 0);
  let budget = meta.head_max_len - used();
  if (budget < 16) { // too many / too long options: shrink every option text evenly (mirrors Python)
    const per = Math.max(4, Math.floor((meta.head_max_len - 16) / Math.max(1, optIds.length)));
    optIds = optIds.map((o) => o.slice(0, per));
    budget = meta.head_max_len - used();
  }
  headIds = headIds.slice(0, Math.max(8, budget));
  const ids = [meta.cls_id, ...headIds, meta.sep_id];
  const markers: number[] = [];
  for (const o of optIds) { markers.push(ids.length); ids.push(...o); }
  ids.push(meta.sep_id);
  const room = Math.max(0, meta.max_len - ids.length - 1);
  const st = enc.encode(strip(state)).slice(0, room);
  const all = [...ids, ...st, meta.sep_id].slice(0, meta.max_len);
  return { ids: all, markers: markers.filter((m) => m < meta.max_len) };
}

export function tempBucket(qtype: 0 | 1, k: number): string {
  const size = k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+';
  return `${qtype === 0 ? 'choice' : 'score'}:${size}`;
}

export function toAnswer(q: LayaQuestion, logits: number[], meta: LayaMeta): LayaAnswer {
  const k = logits.length;
  const qt = QTYPE[q.type];
  const t = meta.temperature_by_options[tempBucket(qt, k)] ?? meta.temperature[qt];
  const z = logits.map((x) => x / t);
  const mx = Math.max(...z);
  const e = z.map((x) => Math.exp(x - mx));
  const s = e.reduce((a, b) => a + b, 0);
  const p = e.map((x) => x / s);
  const ent = -p.reduce((a, v) => a + v * Math.log(Math.min(1, Math.max(v, 1e-12))), 0);
  const confidence = round4(k < 2 ? 1 : 1 - ent / Math.log(k));
  const keys = optionKeys(q);
  const probabilities = Object.fromEntries(keys.map((key, i) => [key, round4(p[i])]));
  if (q.type === 'choice') {
    const best = p.indexOf(Math.max(...p));
    return { type: 'choice', choice: keys[best], probabilities, confidence };
  }
  return { type: 'score', score: round4(p.reduce((a, v, i) => a + i * v, 0)), probabilities, confidence };
}

export function layaState(app: string, title: string | null, text: string | null): string {
  return `App: ${app}\nWindow: ${title ?? ''}\nScreen text: ${(text ?? '').slice(0, 1500)}`;
}

export interface LayaRunner { ask(state: string, questions: Record<string, LayaQuestion>): Promise<Record<string, LayaAnswer>> }

export async function loadLaya(dir: string, onnxFile = 'laya.onnx'): Promise<LayaRunner> {
  const [{ PreTrainedTokenizer }, ort] = await Promise.all([import('@huggingface/transformers'), import('onnxruntime-node')]);
  const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const tok = new PreTrainedTokenizer(read('tokenizer.json') as object, read('tokenizer_config.json') as object);
  const enc: TokenEncoder = { encode: (t) => tok.encode(t, { add_special_tokens: false }) as number[] };
  const meta = read('laya-meta.json') as LayaMeta;
  const session = await ort.InferenceSession.create(join(dir, onnxFile));

  return {
    async ask(state, questions) {
      const qids = Object.keys(questions);
      const seqs = qids.map((id) => {
        const s = buildSequence(enc, meta, state, questions[id]);
        if (s.markers.length !== renderOptions(questions[id]).length) throw new Error(`question ${id}: options do not fit in head_max_len=${meta.head_max_len}`);
        return s;
      });
      const n = seqs.length;
      const L = Math.max(...seqs.map((s) => s.ids.length));
      const K = Math.max(...seqs.map((s) => s.markers.length));
      const ids = new BigInt64Array(n * L).fill(BigInt(meta.pad_id));
      const att = new BigInt64Array(n * L);
      const mpos = new BigInt64Array(n * K);
      const mmask = new BigInt64Array(n * K);
      const qtype = new BigInt64Array(n);
      seqs.forEach((s, r) => {
        s.ids.forEach((v, i) => { ids[r * L + i] = BigInt(v); att[r * L + i] = 1n; });
        s.markers.forEach((m, i) => { mpos[r * K + i] = BigInt(m); mmask[r * K + i] = 1n; });
        qtype[r] = BigInt(QTYPE[questions[qids[r]].type]);
      });
      const out = await session.run({
        input_ids: new ort.Tensor('int64', ids, [n, L]),
        attention_mask: new ort.Tensor('int64', att, [n, L]),
        marker_pos: new ort.Tensor('int64', mpos, [n, K]),
        marker_mask: new ort.Tensor('int64', mmask, [n, K]),
        qtype: new ort.Tensor('int64', qtype, [n])
      });
      const logits = out.logits.data as Float32Array;
      return Object.fromEntries(qids.map((id, r) => [
        id, toAnswer(questions[id], Array.from(logits.subarray(r * K, r * K + seqs[r].markers.length)), meta)
      ]));
    }
  };
}
