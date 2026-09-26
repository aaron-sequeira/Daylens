import type Anthropic from '@anthropic-ai/sdk';
import type { DaySummary, AiSummaryResult, AiSummaryError, AiProvider } from '../../shared/types';
import { complete } from '@worksight/core/ai';

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

export async function generateAiSummary(summary: DaySummary, deps: AiDeps): Promise<AiSummaryResult | AiSummaryError> {
  const { system, user } = buildSummaryPrompt(summary);
  const r = await complete({ system, user, maxTokens: 400 }, { ...deps, title: 'WorkSight Agent' });
  if (!r.ok) return r.error === 'no_key' ? { error: 'no_key' } : { error: 'failed', message: r.message };
  return { text: r.text, model: deps.model, generatedAt: Date.now() };
}
