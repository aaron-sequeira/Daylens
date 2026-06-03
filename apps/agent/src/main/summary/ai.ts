import Anthropic from '@anthropic-ai/sdk';
import type { DaySummary, AiSummaryResult, AiSummaryError } from '../../shared/types';

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
  createClient?: (apiKey: string) => Anthropic;
}

export async function generateAiSummary(summary: DaySummary, deps: AiDeps): Promise<AiSummaryResult | AiSummaryError> {
  if (!deps.apiKey) return { error: 'no_key' };
  const client = (deps.createClient ?? ((k) => new Anthropic({ apiKey: k })))(deps.apiKey);
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
