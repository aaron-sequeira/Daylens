import { describe, it, expect } from 'vitest';
import { complete } from './complete';

const req = { system: 'sys', user: 'hello', maxTokens: 50 };

describe('complete', () => {
  it('returns no_key without a key', async () => {
    expect(await complete(req, { apiKey: null, model: 'm' })).toEqual({ ok: false, error: 'no_key' });
  });
  it('calls Anthropic with a cached system prompt', async () => {
    let args: any;
    const client = { messages: { create: async (a: unknown) => { args = a; return { content: [{ type: 'text', text: ' hi ' }] }; } } };
    const r = await complete(req, { apiKey: 'k', model: 'claude-haiku-4-5', createClient: () => client as never });
    expect(r).toEqual({ ok: true, text: 'hi' });
    expect(args).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hello' }] });
    expect(args.system[0]).toMatchObject({ text: 'sys', cache_control: { type: 'ephemeral' } });
  });
  it('calls an OpenAI-compatible provider, asking for JSON when json is set', async () => {
    let url = '', body: any, headers: any;
    const fetchFn = (async (u: string, init: any) => { url = u; body = JSON.parse(init.body); headers = init.headers;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }; }) as unknown as typeof fetch;
    const r = await complete({ ...req, json: true }, { apiKey: 'sk', model: 'gpt', provider: 'openai', fetchFn, title: 'Daylens' });
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(headers['X-Title']).toBe('Daylens');
    expect(r).toEqual({ ok: true, text: '{"a":1}' });
  });
  it('omits response_format when json is not set', async () => {
    let body: any;
    const fetchFn = (async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; }) as unknown as typeof fetch;
    await complete(req, { apiKey: 'sk', model: 'm', provider: 'openrouter', fetchFn });
    expect(body.response_format).toBeUndefined();
  });
  it('fails on HTTP errors, empty output and a custom provider without base URL', async () => {
    const bad = (async () => ({ ok: false, status: 429, text: async () => 'slow down' })) as unknown as typeof fetch;
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'openai', fetchFn: bad })).toMatchObject({ ok: false, error: 'failed', message: expect.stringContaining('429') });
    const empty = (async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) })) as unknown as typeof fetch;
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'openai', fetchFn: empty })).toMatchObject({ ok: false, error: 'failed' });
    expect(await complete(req, { apiKey: 'sk', model: 'm', provider: 'custom' })).toMatchObject({ ok: false, error: 'failed' });
  });
});
