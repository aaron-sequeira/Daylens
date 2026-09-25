import { describe, it, expect } from 'vitest';
import type { LayaAnswer, LayaRunner } from './laya';
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
  it('asks Laya once per read with the spec state string and stores labels', async () => {
    const seen: string[] = [];
    const out = await labelReads(fake(seen), [{ id: 3, app: 'Code', title: 'a.ts', text: 'const x' }]);
    expect(seen).toEqual(['App: Code\nWindow: a.ts\nScreen text: const x']);
    expect(out).toEqual([{ id: 3, category: 'work', categoryConf: 0.9, activity: 'uncertain', activityConf: 0.2, stuck: 0.5, distraction: 0 }]);
  });
});

describe('protocol', () => {
  it('validates requests and responses', () => {
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1, app: 'a', title: null, text: 't' }] }).success).toBe(true);
    expect(brainRequest.safeParse({ op: 'label', modelDir: 'C:/m', reads: [{ id: 1.5, app: 'a', title: null, text: 't' }] }).success).toBe(false);
    expect(brainResponse.safeParse({ op: 'error', message: 'x' }).success).toBe(true);
    expect(brainResponse.safeParse({ op: 'labels', results: [{ id: 1, category: 'work', categoryConf: 0.9, activity: null, activityConf: null, stuck: 3, distraction: null }] }).success).toBe(false);
  });
});
