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

  it('generates via an OpenAI-compatible provider (OpenRouter) using fetch', async () => {
    let url = ''; let auth = ''; let bodyModel = '';
    const fakeFetch = (async (u: string, init: { headers: Record<string, string>; body: string }) => {
      url = u; auth = init.headers['Authorization']; bodyModel = JSON.parse(init.body).model;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'You spent 4.2 hours in Code.' } }] }) };
    }) as unknown as typeof fetch;
    const r = await generateAiSummary(summary, {
      apiKey: 'sk-or', model: 'openai/gpt-oss-120b:free', provider: 'openrouter', fetchFn: fakeFetch
    });
    expect(url).toContain('openrouter.ai/api/v1/chat/completions');
    expect(auth).toBe('Bearer sk-or');
    expect(bodyModel).toBe('openai/gpt-oss-120b:free');
    expect(r).toEqual(expect.objectContaining({ text: 'You spent 4.2 hours in Code.', model: 'openai/gpt-oss-120b:free' }));
  });

  it('surfaces an http error from an OpenAI-compatible provider', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 401, text: async () => 'bad key' })) as unknown as typeof fetch;
    const r = await generateAiSummary(summary, { apiKey: 'sk-x', model: 'm', provider: 'openai', fetchFn: fakeFetch });
    expect(r).toEqual(expect.objectContaining({ error: 'failed' }));
  });

  it('fails clearly when a custom provider has no base url', async () => {
    const r = await generateAiSummary(summary, { apiKey: 'sk-x', model: 'm', provider: 'custom' });
    expect(r).toEqual(expect.objectContaining({ error: 'failed' }));
  });
});
