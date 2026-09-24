import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSequence, loadLaya, type LayaMeta, type LayaQuestion, type TokenEncoder } from './laya';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_DIR = process.env.LAYA_DIR ?? join(here, '../../../.models/laya');
const ONNX = process.env.LAYA_ONNX ?? 'laya.onnx';
const TOOLS = join(here, '../../../../../tools/laya');
// Opt-in: loads the 1.7 GB model. Runs only via `pnpm --filter @worksight/consumer test:parity` (pnpm sets
// npm_lifecycle_event, so it works in cmd, PowerShell and Git Bash) or with LAYA_PARITY set; never in plain `pnpm test`.
const optedIn = !!process.env.LAYA_PARITY || process.env.npm_lifecycle_event === 'test:parity';
const have = optedIn && existsSync(join(MODEL_DIR, ONNX)) && existsSync(join(TOOLS, 'golden.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

describe.skipIf(!have)(`Laya ONNX parity (${ONNX})`, () => {
  const questions = json<Record<string, LayaQuestion>>(join(TOOLS, 'questions.json'));

  it('builds token sequences identical to Python build_sequence', async () => {
    const { PreTrainedTokenizer } = await import('@huggingface/transformers');
    const tok = new PreTrainedTokenizer(json(join(MODEL_DIR, 'tokenizer.json')), json(join(MODEL_DIR, 'tokenizer_config.json')));
    const enc: TokenEncoder = { encode: (t) => tok.encode(t, { add_special_tokens: false }) as number[] };
    const meta = json<LayaMeta>(join(MODEL_DIR, 'laya-meta.json'));
    const golden = json<{ id: number; state: string }[]>(join(TOOLS, 'golden.json'));
    const stateOf = new Map(golden.map((g) => [g.id, g.state]));
    const seqs = json<{ id: number; qid: string; ids: number[]; markers: number[] }[]>(join(TOOLS, 'sequences.json'));
    let mismatches = 0;
    for (const s of seqs) {
      const got = buildSequence(enc, meta, stateOf.get(s.id)!, questions[s.qid]);
      if (JSON.stringify(got.ids) !== JSON.stringify(s.ids) || JSON.stringify(got.markers) !== JSON.stringify(s.markers)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('matches golden decisions: >= 98% choices, scores within 0.05', async () => {
    const laya = await loadLaya(MODEL_DIR, ONNX);
    const golden = json<{ id: number; state: string; answers: Record<string, { choice?: string; score?: number }> }[]>(join(TOOLS, 'golden.json'));
    let agree = 0, total = 0, worstScore = 0;
    const t0 = Date.now();
    for (const g of golden) {
      const ans = await laya.ask(g.state, questions);
      for (const [qid, a] of Object.entries(ans)) {
        if (a.type === 'choice') { total++; if (a.choice === g.answers[qid].choice) agree++; }
        else worstScore = Math.max(worstScore, Math.abs(a.score - (g.answers[qid].score ?? 0)));
      }
    }
    console.log(`[laya parity ${ONNX}] choices ${agree}/${total}, worst score error ${worstScore.toFixed(4)}, ${((Date.now() - t0) / golden.length).toFixed(0)} ms/read`);
    expect(agree / total).toBeGreaterThanOrEqual(0.98);
    expect(worstScore).toBeLessThanOrEqual(0.05);
  }, 600_000);
});
