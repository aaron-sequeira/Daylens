import type { AiProvider } from '../../shared/types';

export interface ProviderMeta {
  id: AiProvider;
  label: string;
  defaultModel: string;
  keyUrl: string; // where to create a key ('' for custom)
  custom?: boolean; // shows the Base URL field
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', defaultModel: 'claude-haiku-4-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-1.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-3.5-haiku', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '', keyUrl: '', custom: true }
];

export const providerMeta = (id: AiProvider): ProviderMeta =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
