import type Database from 'better-sqlite3';

export interface Encryptor { encrypt(s: string): Buffer; decrypt(b: Buffer): string; }
export interface SecretStore { has(provider: string): boolean; get(provider: string): string | null; set(provider: string, key: string): void; clear(provider: string): void; }

// Same key naming as the WorkSight agent: one encrypted key per provider in the settings table.
const keyName = (provider: string): string => `ai_key_${provider}_enc`;

export function createSecretStore(db: Database.Database, enc: Encryptor): SecretStore {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  const raw = (p: string): string | null => (read.get(keyName(p)) as { value: string } | undefined)?.value ?? null;
  return {
    has: (p) => raw(p) !== null,
    get: (p) => { const r = raw(p); if (r === null) return null; try { return enc.decrypt(Buffer.from(r, 'base64')); } catch { return null; } },
    set: (p, key) => { write.run(keyName(p), enc.encrypt(key).toString('base64')); },
    clear: (p) => { del.run(keyName(p)); }
  };
}
