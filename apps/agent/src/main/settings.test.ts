import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './db/schema';
import { createSettingsStore, SettingsStore } from './settings';

const enc = { encrypt: (s: string) => Buffer.from(s, 'utf8'), decrypt: (b: Buffer) => b.toString('utf8') };

let store: SettingsStore;
beforeEach(() => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  store = createSettingsStore(db, enc);
});

describe('settings', () => {
  it('returns defaults when empty', () => {
    const s = store.get();
    expect(s.idleThresholdSec).toBe(60);
    expect(s.consentGranted).toBe(false);
    expect(s.hasApiKey).toBe(false);
    expect(s.aiModel).toBe('claude-haiku-4-5');
  });

  it('persists a partial update', () => {
    store.set({ consentGranted: true, idleThresholdSec: 120 });
    const s = store.get();
    expect(s.consentGranted).toBe(true);
    expect(s.idleThresholdSec).toBe(120);
  });

  it('stores the api key encrypted and never returns it via get()', () => {
    store.setApiKey('sk-test');
    expect(store.get().hasApiKey).toBe(true);
    expect(store.getApiKey()).toBe('sk-test');
    expect((store.get() as unknown as Record<string, unknown>).anthropicApiKey).toBeUndefined();
  });

  it('defaults aiProvider to anthropic with an empty base url', () => {
    expect(store.get().aiProvider).toBe('anthropic');
    expect(store.get().aiBaseUrl).toBe('');
  });

  it('stores api keys per provider and remembers each independently', () => {
    store.set({ aiProvider: 'openai' });
    store.setApiKey('sk-openai');
    expect(store.get().hasApiKey).toBe(true);
    expect(store.getApiKey()).toBe('sk-openai');

    store.set({ aiProvider: 'gemini' });
    expect(store.get().hasApiKey).toBe(false); // gemini has no key yet
    expect(store.getApiKey()).toBeNull();

    store.set({ aiProvider: 'openai' });
    expect(store.getApiKey()).toBe('sk-openai'); // openai's key is still there
  });
});
