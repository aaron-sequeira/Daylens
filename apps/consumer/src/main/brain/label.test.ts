import { describe, it, expect } from 'vitest';
import type { LayaAnswer, LayaRunner } from './laya';
import type { StoredLabel } from '../screen/labels';
import { labelReads } from './label';
import { brainRequest, brainResponse } from './protocol';

const fake = (seen: string[]): LayaRunner => ({
  async ask(state, questions) {
    seen.push(state);
    expect(Object.keys(questions).sort()).toEqual(['activity', 'category', 'distraction', 'stuck']);
    const c = (v: string, conf: number): LayaAnswer => ({ type: 'choice', choice: v, probabilities: {}, confidence: conf });
    const s = (v: number): LayaAnswer => ({ type: 'score', score: v, probabilities: {}, confidence: 1 });
    return { category: c('work', 0.9), activity: c('coding', 0.2), stuck: s(0.5), distraction: s(0) };
  }
});

describe('labelReads', () => {
  it('asks Laya once per read with the spec state string and reports each label', async () => {
    const seen: string[] = [];
    const out: StoredLabel[] = [];
    await labelReads(fake(seen), [{ id: 3, app: 'Code', title: 'a.ts', text: 'const x' }], (l) => out.push(l));
    expect(seen).toEqual(['App: Code\nWindow: a.ts\nScreen text: const x']);
    expect(out).toEqual([{ id: 3, category: 'work', categoryConf: 0.9, activity: 'coding', activityConf: 0.2, stuck: 0.5, distraction: 0 }]);
  });
  it('reports each result as soon as its read is done, before asking about the next read', async () => {
    const events: string[] = [];
    const runner: LayaRunner = { async ask(state) { events.push(`ask ${state.split('\n')[0]}`); return {}; } };
    await labelReads(runner, [{ id: 1, app: 'A', title: null, text: 'x' }, { id: 2, app: 'B', title: null, text: 'y' }], (l) => events.push(`result ${l.id}`));
    expect(events).toEqual(['ask App: A', 'result 1', 'ask App: B', 'result 2']);
  });
});

describe('protocol', () => {
  it('validates requests and responses', () => {
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1, app: 'a', title: null, text: 't' }] }).success).toBe(true);
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1.5, app: 'a', title: null, text: 't' }] }).success).toBe(false);
    expect(brainResponse.safeParse({ op: 'error', message: 'x' }).success).toBe(true);
    expect(brainResponse.safeParse({ op: 'done' }).success).toBe(true);
    const ok = { id: 1, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: 1, distraction: null };
    expect(brainResponse.safeParse({ op: 'label', result: ok }).success).toBe(true);
    expect(brainResponse.safeParse({ op: 'label', result: { ...ok, stuck: 3 } }).success).toBe(false);
    expect(brainResponse.safeParse({ op: 'labels', results: [ok] }).success).toBe(false); // old batch shape is gone
    expect(brainResponse.safeParse({ op: 'done', extra: 1 }).success).toBe(false);
  });
});
