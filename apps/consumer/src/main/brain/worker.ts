/// <reference types="electron" />
import { loadLaya } from './laya';
import { labelReads } from './label';
import { brainRequest } from './protocol';

process.parentPort.once('message', async (e) => {
  try {
    const req = brainRequest.parse(e.data);
    const laya = await loadLaya(req.modelDir);
    process.parentPort.postMessage({ op: 'labels', results: await labelReads(laya, req.reads) });
    // Main process kills the Brain as soon as it has the result; this timer is only a fallback so the process never lingers.
    setTimeout(() => process.exit(0), 2000);
  } catch (err) {
    process.parentPort.postMessage({ op: 'error', message: err instanceof Error ? err.message : String(err) });
    // Main process kills the Brain as soon as it has the result; this timer is only a fallback so the process never lingers.
    setTimeout(() => process.exit(1), 2000);
  }
});
