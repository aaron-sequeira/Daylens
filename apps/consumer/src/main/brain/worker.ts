/// <reference types="electron" />
import { constants, setPriority } from 'node:os';
import { loadLaya } from './laya';
import { labelReads } from './label';
import { brainRequest } from './protocol';

// Labelling is background work: never compete with what the user is doing in the foreground.
try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted: run at normal priority */ }

process.parentPort.once('message', async (e) => {
  try {
    const req = brainRequest.parse(e.data);
    const laya = await loadLaya(req.modelDir);
    // One message per read, so finished work survives a slow or stuck read later in the batch.
    await labelReads(laya, req.reads, (result) => process.parentPort.postMessage({ op: 'label', result }));
    process.parentPort.postMessage({ op: 'done' });
    // Main process kills the Brain as soon as it has 'done'; this timer is only a fallback so the process never lingers.
    setTimeout(() => process.exit(0), 2000);
  } catch (err) {
    process.parentPort.postMessage({ op: 'error', message: err instanceof Error ? err.message : String(err) });
    // Main process kills the Brain as soon as it has the error; this timer is only a fallback so the process never lingers.
    setTimeout(() => process.exit(1), 2000);
  }
});
