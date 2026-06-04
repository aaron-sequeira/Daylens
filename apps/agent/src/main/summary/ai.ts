import Anthropic from '@anthropic-ai/sdk';
import type { DaySummary, AiSummaryResult, AiSummaryError, AiProvider } from '../../shared/types';

const round1 = (sec: number): number => Math.round(sec / 360) / 10; // hours, 1 dp

export function buildSummaryPrompt(summary: DaySummary): { system: string; user: string } {
  const apps = summary.apps
    .map(a => `${a.appName}: ${round1(a.totalSec)}h across ${a.sessions} session(s), ${a.activePct}% active`)
    .join('\n');
  const system =
    'You are a concise productivity assistant. Given a single day of a user\'s tracked desktop activity, ' +
    'write ONE short factual paragraph (2-4 sentences) summarizing how their time was spent. ' +
    'Address the user as "You". Do not invent data; only use the numbers given.';
  const user =
    `Date: ${summary.date}\n` +
    `Total tracked: ${round1(summary.totalTrackedSec)}h (active ${round1(summary.activeSec)}h, idle ${round1(summary.idleSec)}h)\n` +
    `Applications:\n${apps || '(none)'}`;
  return { system, user };
}

export interface AiDeps {
  apiKey: string | null;
  model: string;
  provider?: AiProvider;     // defaults to 'anthropic'
  baseUrl?: string;          // used for the 'custom' provider
  createClient?: (apiKey: string) => Anthropic; // anthropic injection (tests)
  fetchFn?: typeof fetch;     // OpenAI-compatible injection (tests)
}

// OpenAI-compatible chat-completions bases (no trailing slash). OpenAI, OpenRouter, and
// Gemini (via its OpenAI compatibility layer) all accept the same request shape.
const OPENAI_COMPAT_BASE: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
};

export async function generateAiSummary(summary: DaySummary, deps: AiDeps): Promise<AiSummaryResult | AiSummaryError> {
  if (!deps.apiKey) return { error: 'no_key' };
  const provider = deps.provider ?? 'anthropic';
  if (provider === 'anthropic') return generateAnthropic(summary, deps, deps.apiKey);
  const base = provider === 'custom'
    ? (deps.baseUrl?.trim() ? deps.baseUrl.trim().replace(/\/+$/, '') : null)
    : (OPENAI_COMPAT_BASE[provider] ?? null);
  if (!base) return { error: 'failed', message: 'Set a Base URL for the custom provider in Settings.' };
  return generateOpenAiCompatible(summary, deps, deps.apiKey, base);
}

async function generateAnthropic(summary: DaySummary, deps: AiDeps, apiKey: string): Promise<AiSummaryResult | AiSummaryError> {
  const client = (deps.createClient ?? ((k) => new Anthropic({ apiKey: k })))(apiKey);
  const { system, user } = buildSummaryPrompt(summary);
  try {
    const msg = await client.messages.create({
      model: deps.model,
      max_tokens: 400,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }]
    });
    const text = (msg.content as { type: string; text?: string }[])
      .filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
    return { text, model: deps.model, generatedAt: Date.now() };
  } catch (e) {
    return { error: 'failed', message: String(e) };
  }
}

async function generateOpenAiCompatible(summary: DaySummary, deps: AiDeps, apiKey: string, base: string): Promise<AiSummaryResult | AiSummaryError> {
  const { system, user } = buildSummaryPrompt(summary);
  const doFetch = deps.fetchFn ?? fetch;
  try {
    const res = await doFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'WorkSight Agent' },
      body: JSON.stringify({
        model: deps.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 400
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: 'failed', message: `HTTP ${res.status} ${body.slice(0, 300)}`.trim() };
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!text) return { error: 'failed', message: 'The provider returned an empty response.' };
    return { text, model: deps.model, generatedAt: Date.now() };
  } catch (e) {
    return { error: 'failed', message: String(e) };
  }
}
