import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layaState, loadLaya } from './laya';
import { QUESTIONS } from './questions';
import { scoreRun, type EvalRow } from './evalScore';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_DIR = process.env.LAYA_DIR ?? join(here, '../../../.models/laya');
const TOOLS = join(here, '../../../../../tools/laya');
// Opt-in only (loads the 1.7 GB model): `pnpm --filter @worksight/consumer test:eval` or LAYA_EVAL=1.
const optedIn = !!process.env.LAYA_EVAL || process.env.npm_lifecycle_event === 'test:eval';
const have = optedIn && existsSync(join(MODEL_DIR, 'laya.onnx'));
const GATE = 0.8; // Phase 4 spec §3.3; lower only as a recorded accepted risk (tools/laya/SPIKE-RESULTS.md)

type Sample = { id: number; app: string; title: string | null; text: string; expect_category: string };
const load = (f: string): Sample[] => readFileSync(join(TOOLS, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Sample);

describe.skipIf(!have)('Laya category accuracy (tuning + hold-out)', () => {
  it('meets the gate with the app-name tie-breaker', async () => {
    const laya = await loadLaya(MODEL_DIR);
    const run = async (samples: Sample[]): Promise<EvalRow[]> => {
      const rows: EvalRow[] = [];
      for (const s of samples) {
        const a = (await laya.ask(layaState(s.app, s.title, s.text), { category: QUESTIONS.category })).category;
        if (a.type !== 'choice') throw new Error('category must be a choice');
        rows.push({ id: s.id, expected: s.expect_category, choice: a.choice, confidence: a.confidence, app: s.app });
      }
      return rows;
    };
    const tune = await run(load('samples.jsonl'));
    const hold = await run(load('samples.holdout.jsonl'));
    const t = scoreRun(tune), h = scoreRun(hold), all = scoreRun([...tune, ...hold]);
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
    // Metadata only: ids, labels and confidences — never screen text.
    console.log(`[laya eval] tuning laya ${pct(t.layaAcc)} final ${pct(t.finalAcc)} | holdout laya ${pct(h.layaAcc)} final ${pct(h.finalAcc)} | all final ${pct(all.finalAcc)}`);
    console.log('[laya eval] confusion (expected -> got):', JSON.stringify(all.confusion));
    console.log('[laya eval] wrong:', [...tune, ...hold].filter((r) => r.choice !== r.expected).map((r) => `${r.id}:${r.expected}->${r.choice}@${r.confidence.toFixed(2)}`).join(' '));
    expect(all.finalAcc).toBeGreaterThanOrEqual(GATE);
    expect(t.finalAcc - h.finalAcc).toBeLessThanOrEqual(0.1);
  }, 900_000);
});
