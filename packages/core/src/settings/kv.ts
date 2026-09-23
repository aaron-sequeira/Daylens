import type Database from 'better-sqlite3';

export type KvValue = string | number | boolean;
export interface KvStore<T extends Record<string, KvValue>> { get(): T; set(patch: Partial<T>): T; }

/** Typed settings over the key/value `settings` table. Types come from `defaults`; unknown keys are ignored. */
export function createKvStore<T extends Record<string, KvValue>>(db: Database.Database, defaults: T): KvStore<T> {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const get = (): T => {
    const out: Record<string, KvValue> = { ...defaults };
    for (const [key, def] of Object.entries(defaults)) {
      const row = read.get(key) as { value: string } | undefined;
      if (!row) continue;
      if (typeof def === 'number') { const n = Number(row.value); if (Number.isFinite(n)) out[key] = n; }
      else if (typeof def === 'boolean') out[key] = row.value === 'true';
      else out[key] = row.value;
    }
    return out as T;
  };
  const set = (patch: Partial<T>): T => {
    db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (k in defaults && v !== undefined) write.run(k, String(v));
    })();
    return get();
  };
  return { get, set };
}
