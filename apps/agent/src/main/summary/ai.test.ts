import { describe, it, expect } from 'vitest';
import { buildSummaryPrompt, generateAiSummary } from './ai';
import type { DaySummary } from '../../shared/types';

const summary: DaySummary = {
  date: '2026-06-03', totalTrackedSec: 15120, activeSec: 12000, idleSec: 3120,
  apps: [{ appName: 'Code', totalSec: 15120, sessions: 9, firstOpenAt: 1, lastCloseAt: 2, activePct: 80 }]
};

describe('ai summary', () => {
  it('builds a prompt that includes app names and the date', () => {
    const p = buildSummaryPrompt(summary);
    expect(p.user).toContain('Code');
    expect(p.user).toContain('2026-06-03');
    expect(p.system.length).toBeGreaterThan(0);
  });

  it('returns no_key when no api key is provided', async () => {
    const r = await generateAiSummary(summary, { apiKey: null, model: 'claude-haiku-4-5' });
    expect(r).toEqual({ error: 'no_key' });
  });

  it('returns generated text via an injected client', async () => {
    const fakeClient = { messages: { create: async () => ({ content: [{ type: 'text', text: 'You spent 4.2 hours in Code.' }] }) } };
    const r = await generateAiSummary(summary, {
      apiKey: 'sk-test', model: 'claude-haiku-4-5',
      createClient: () => fakeClient as never
    });
    expect(r).toEqual(expect.objectContaining({ text: 'You spent 4.2 hours in Code.', model: 'claude-haiku-4-5' }));
  });

  it('returns provider_not_wired for a non-anthropic provider without calling a client', async () => {
    let called = false;
    const r = await generateAiSummary(summary, {
      apiKey: 'sk-openai', model: 'gpt-4o-mini', provider: 'openai',
      createClient: () => { called = true; return {} as never; }
    });
    expect(r).toEqual({ error: 'provider_not_wired' });
    expect(called).toBe(false);
  });
});
