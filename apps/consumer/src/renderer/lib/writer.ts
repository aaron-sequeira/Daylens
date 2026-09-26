import type { WriterState } from '../../main/report/view';

const gb = (b: number): string => `${(b / 1e9).toFixed(1)} GB`;
export function writerStatusText(s: WriterState): string {
  switch (s.state) {
    case 'ready': return s.mode === 'local' ? `Ready · ${s.model} on this PC` : `Ready · cloud (${s.model})`;
    case 'missing': return `Not downloaded (${gb(s.sizeBytes)})`;
    case 'downloading': return `Downloading… ${Math.floor((s.received / Math.max(1, s.total)) * 100)}%`;
    case 'verifying': return 'Checking the download…';
    case 'unavailable': return `Can't run on this PC: ${s.text}`;
    case 'cloud_setup': return 'Cloud chosen · add your API key';
  }
}
export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-haiku-4-5', needsBaseUrl: false },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1-mini', needsBaseUrl: false },
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', needsBaseUrl: false },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-oss-120b:free', needsBaseUrl: false },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '', needsBaseUrl: true }
] as const;
