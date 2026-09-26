import Anthropic from '@anthropic-ai/sdk';

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';
export interface CompleteRequest { system: string; user: string; maxTokens: number; json?: boolean; }
export interface CompleteDeps {
  apiKey: string | null; model: string; provider?: AiProvider; baseUrl?: string; title?: string;
  createClient?: (apiKey: string) => Anthropic; fetchFn?: typeof fetch; signal?: AbortSignal;
}
export type CompleteResult = { ok: true; text: string } | { ok: false; error: 'no_key' | 'failed'; message?: string };

// OpenAI-compatible chat-completions bases (no trailing slash).
const OPENAI_COMPAT_BASE: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
};

export async function complete(req: CompleteRequest, deps: CompleteDeps): Promise<CompleteResult> {
  if (!deps.apiKey) return { ok: false, error: 'no_key' };
  const provider = deps.provider ?? 'anthropic';
  if (provider === 'anthropic') return anthropic(req, deps, deps.apiKey);
  const base = provider === 'custom'
    ? (deps.baseUrl?.trim() ? deps.baseUrl.trim().replace(/\/+$/, '') : null)
    : (OPENAI_COMPAT_BASE[provider] ?? null);
  if (!base) return { ok: false, error: 'failed', message: 'Set a Base URL for the custom provider in Settings.' };
  return openAiCompatible(req, deps, deps.apiKey, base);
}

async function anthropic(req: CompleteRequest, deps: CompleteDeps, apiKey: string): Promise<CompleteResult> {
  const client = (deps.createClient ?? ((k) => new Anthropic({ apiKey: k })))(apiKey);
  try {
    const msg = await client.messages.create({
      model: deps.model, max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }]
    }, deps.signal ? { signal: deps.signal } : undefined);
    const text = (msg.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    return text ? { ok: true, text } : { ok: false, error: 'failed', message: 'The provider returned an empty response.' };
  } catch (e) {
    return { ok: false, error: 'failed', message: String(e) };
  }
}

async function openAiCompatible(req: CompleteRequest, deps: CompleteDeps, apiKey: string, base: string): Promise<CompleteResult> {
  const doFetch = deps.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${base}/chat/completions`, {
      method: 'POST', signal: deps.signal,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': deps.title ?? 'WorkSight' },
      body: JSON.stringify({
        model: deps.model, max_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        ...(req.json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: 'failed', message: `HTTP ${res.status} ${body.slice(0, 300)}`.trim() };
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'failed', message: 'The provider returned an empty response.' };
  } catch (e) {
    return { ok: false, error: 'failed', message: String(e) };
  }
}
