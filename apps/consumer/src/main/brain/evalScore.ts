export { finalCategory } from './finalCategory';
import { finalCategory } from './finalCategory';

export interface EvalRow { id: number; expected: string; choice: string; confidence: number; app: string; }
export interface EvalScore { n: number; layaAcc: number; finalAcc: number; confusion: Record<string, Record<string, number>>; }

export function scoreRun(rows: EvalRow[]): EvalScore {
  const confusion: Record<string, Record<string, number>> = {};
  let laya = 0, fin = 0;
  for (const r of rows) {
    if (r.choice === r.expected) laya++;
    if (finalCategory(r.choice, r.confidence, r.app) === r.expected) fin++;
    const row = (confusion[r.expected] ??= {});
    row[r.choice] = (row[r.choice] ?? 0) + 1;
  }
  const n = rows.length;
  return { n, layaAcc: n ? laya / n : 0, finalAcc: n ? fin / n : 0, confusion };
}
