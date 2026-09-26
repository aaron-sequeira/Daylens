import { describe, it, expect } from 'vitest';
import { PROVIDERS, writerStatusText } from './writer';

describe('writer UI helpers', () => {
  it('describes each writer state', () => {
    expect(writerStatusText({ state: 'ready', mode: 'local', model: 'Qwen3 4B' })).toBe('Ready · Qwen3 4B on this PC');
    expect(writerStatusText({ state: 'ready', mode: 'cloud', model: 'claude-haiku-4-5' })).toBe('Ready · cloud (claude-haiku-4-5)');
    expect(writerStatusText({ state: 'missing', tier: '4b', sizeBytes: 2_497_281_120 })).toBe('Not downloaded (2.5 GB)');
    expect(writerStatusText({ state: 'downloading', received: 1_248_640_560, total: 2_497_281_120 })).toBe('Downloading… 50%');
    expect(writerStatusText({ state: 'verifying' })).toBe('Checking the download…');
    expect(writerStatusText({ state: 'unavailable', reason: 'low_ram', text: 'Too little memory.' })).toBe("Can't run on this PC: Too little memory.");
    expect(writerStatusText({ state: 'cloud_setup' })).toBe('Cloud chosen · add your API key');
  });
  it('lists providers with default models', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']);
    expect(PROVIDERS.find((p) => p.id === 'custom')?.needsBaseUrl).toBe(true);
  });
});
