import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createSecretStore } from './secrets';

const enc = { encrypt: (s: string) => Buffer.from(`x${s}`), decrypt: (b: Buffer) => b.toString().slice(1) };
describe('secret store', () => {
  it('stores keys per provider, encrypted', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const s = createSecretStore(db, enc);
    expect(s.has('openai')).toBe(false);
    s.set('openai', 'sk-1');
    expect(s.get('openai')).toBe('sk-1');
    expect(s.get('anthropic')).toBeNull();
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'ai_key_openai_enc'").get() as { value: string };
    expect(raw.value).not.toContain('sk-1');
    s.clear('openai');
    expect(s.has('openai')).toBe(false);
  });
});
