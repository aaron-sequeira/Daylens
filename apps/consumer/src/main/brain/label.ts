import { layaState, type LayaRunner } from './laya';
import { QUESTIONS } from './questions';
import { toStoredLabel, type ReadToLabel, type StoredLabel } from '../screen/labels';

/** Labels reads in order, handing each result to onResult as soon as that read is done. */
export async function labelReads(runner: LayaRunner, reads: ReadToLabel[], onResult: (label: StoredLabel) => void): Promise<void> {
  for (const r of reads) onResult(toStoredLabel(r.id, await runner.ask(layaState(r.app, r.title, r.text), QUESTIONS)));
}
