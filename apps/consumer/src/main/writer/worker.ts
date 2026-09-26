/// <reference types="electron" />
import { constants, setPriority } from 'node:os';
import { writerRequest } from './protocol';

// Writing is background work: never compete with what the user is doing in the foreground.
try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted */ }

process.parentPort.once('message', async (e) => {
  const fail = (message: string, code: number): void => {
    process.parentPort.postMessage({ op: 'error', message });
    setTimeout(() => process.exit(code), 2000); // main kills us first; this only stops a linger
  };
  let req;
  try { req = writerRequest.parse(e.data); } catch (err) { fail(`bad request: ${String(err)}`, 1); return; }
  let llama, model, context;
  try {
    const { getLlama } = await import('node-llama-cpp'); // ESM-only package: dynamic import from the CJS bundle
    llama = await getLlama({ gpu: req.gpu === 'off' ? false : 'auto' });
    model = await llama.loadModel({ modelPath: req.modelPath });
    context = await model.createContext({ contextSize: req.contextSize });
  } catch (err) { fail(`load: ${err instanceof Error ? err.message : String(err)}`, 1); return; }
  try {
    // The input must leave room for the answer (plus ~256 tokens of chat template); a fixed message, never the text.
    const inputTokens = model.tokenize(req.system).length + model.tokenize(req.user).length;
    if (inputTokens > context.contextSize - req.maxTokens - 256) { fail('input too long', 1); return; }
    const { LlamaChatSession } = await import('node-llama-cpp');
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: req.system });
    const grammar = await llama.createGrammarForJsonSchema(req.schema as never);
    const text = await session.prompt(req.user, { grammar, maxTokens: req.maxTokens, budgets: { thoughtTokens: 0 } });
    process.parentPort.postMessage({ op: 'written', json: grammar.parse(text) });
    setTimeout(() => process.exit(0), 2000);
  } catch (err) {
    // grammar.parse() JSON.parses the model's raw text, then validates it against the schema; both failure paths
    // (LlamaJsonSchemaValidationError, JSON SyntaxError) embed the model's raw output in err.message. The load-error
    // path above is safe to forward verbatim (it describes the file, not the model), but this one is not: never let
    // model output reach the main process's logs or stored error text, so post a fixed message instead.
    const invalidOutput = err instanceof SyntaxError || (err as { constructor?: { name?: string } })?.constructor?.name === 'LlamaJsonSchemaValidationError';
    fail(invalidOutput ? 'invalid output' : 'generation failed', 1);
  }
});
