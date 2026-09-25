import { categoryForApp } from '../../shared/categories';
import { CONFIDENT } from './questions';

export interface EvalRow { id: number; expected: string; choice: string; confidence: number; app: string; }
export interface EvalScore { n: number; layaAcc: number; finalAcc: number; confusion: Record<string, Record<string, number>>; }

/** What Today would show: a confident Laya choice, else the app-name rule (same logic as the Today view). */
export function finalCategory(choice: string, confidence: number, app: string): string {
  return confidence >= CONFIDENT ? choice : categoryForApp(app);
}

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
