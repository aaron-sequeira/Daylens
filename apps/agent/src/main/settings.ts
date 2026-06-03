import type Database from 'better-sqlite3';
import type { AppSettings } from '../shared/types';

export interface Encryptor { encrypt(s: string): Buffer; decrypt(b: Buffer): string; }

export interface SettingsStore {
  get(): AppSettings;
  set(patch: Partial<Omit<AppSettings, 'hasApiKey'>>): void;
  setApiKey(key: string): void;
  getApiKey(): string | null;
}

const DEFAULTS: Omit<AppSettings, 'hasApiKey'> = {
  idleThresholdSec: 60,
  captureWindowTitles: true,
  aiEnabled: false,
  aiModel: 'claude-haiku-4-5',
  pollIntervalMs: 2000,
  bucketSizeSec: 60,
  trackingPaused: false,
  consentGranted: false
};

const API_KEY = 'anthropic_api_key_enc';

export function createSettingsStore(db: Database.Database, enc: Encryptor): SettingsStore {
  const readRaw = (key: string): string | null => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  };
  const writeRaw = (key: string, value: string): void => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
  };

  return {
    get() {
      const out = { ...DEFAULTS } as Omit<AppSettings, 'hasApiKey'>;
      for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
        const raw = readRaw(key);
        if (raw === null) continue;
        const def = DEFAULTS[key];
        (out as Record<string, unknown>)[key] =
          typeof def === 'number' ? Number(raw) : typeof def === 'boolean' ? raw === 'true' : raw;
      }
      return { ...out, hasApiKey: readRaw(API_KEY) !== null };
    },
    set(patch) {
      for (const [k, v] of Object.entries(patch)) writeRaw(k, String(v));
    },
    setApiKey(key) {
      writeRaw(API_KEY, enc.encrypt(key).toString('base64'));
    },
    getApiKey() {
      const raw = readRaw(API_KEY);
      return raw === null ? null : enc.decrypt(Buffer.from(raw, 'base64'));
    }
  };
}
