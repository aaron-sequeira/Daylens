import { layaState, type LayaRunner } from './laya';
import { QUESTIONS } from './questions';
import { toStoredLabel, type ReadToLabel, type StoredLabel } from '../screen/labels';

export async function labelReads(runner: LayaRunner, reads: ReadToLabel[]): Promise<StoredLabel[]> {
  const out: StoredLabel[] = [];
  for (const r of reads) out.push(toStoredLabel(r.id, await runner.ask(layaState(r.app, r.title, r.text), QUESTIONS)));
  return out;
}
