import { describe, it, expect } from 'vitest';
import { createCloudController } from './controller';
import type { AppSettings } from '../../shared/types';

function fakeSettings(initial: Partial<AppSettings>) {
  let s = { cloudSyncEnabled: false, cloudSyncWindowDays: 2, ...initial } as AppSettings;
  return { get: () => s, set: (p: Partial<AppSettings>) => { s = { ...s, ...p }; } };
}
const repo = { getFocusSessions: () => [], getActivitySamples: () => [] };

function fakeSession(account: { userId: string; email: string } | null, token: string | null = 'AT') {
  return {
    signIn: async () => ({ ok: true as const }),
    signOut: () => {},
    getAccount: () => account,
    getValidAccessToken: async () => token
  };
}

describe('cloud controller', () => {
  it('reports disconnected status by default', () => {
    const c = createCloudController({ session: fakeSession(null), settings: fakeSettings({}), repo, upsert: async () => ({ ok: true }), now: () => 5 });
    expect(c.getStatus()).toEqual({ connected: false, email: null, enabled: false, lastSyncedAt: null, lastError: null });
  });

  it('syncNow upserts and records lastSyncedAt', async () => {
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => ({ ok: true }), now: () => 999 });
    const r = await c.syncNow();
    expect(r).toEqual({ syncedDays: 2 });
    const st = c.getStatus();
    expect(st).toMatchObject({ connected: true, email: 'a@x.test', enabled: true, lastSyncedAt: 999, lastError: null });
  });

  it('syncNow records lastError on failure', async () => {
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => ({ error: 'permission denied' }), now: () => 1 });
    const r = await c.syncNow();
    expect(r).toEqual({ error: 'permission denied' });
    expect(c.getStatus().lastError).toBe('permission denied');
  });

  it('maybeAutoSync does nothing when disabled or disconnected', async () => {
    let upserts = 0;
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: false }), repo, upsert: async () => { upserts++; return { ok: true }; }, now: () => 1 });
    await c.maybeAutoSync();
    expect(upserts).toBe(0);
  });

  it('maybeAutoSync syncs when enabled and connected', async () => {
    let upserts = 0;
    const c = createCloudController({ session: fakeSession({ userId: 'u1', email: 'a@x.test' }), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => { upserts++; return { ok: true }; }, now: () => 1 });
    await c.maybeAutoSync();
    expect(upserts).toBe(1);
  });

  it('maybeAutoSync does not sync when enabled but disconnected (no account)', async () => {
    let upserts = 0;
    const c = createCloudController({ session: fakeSession(null), settings: fakeSettings({ cloudSyncEnabled: true }), repo, upsert: async () => { upserts++; return { ok: true }; }, now: () => 1 });
    await c.maybeAutoSync();
    expect(upserts).toBe(0);
  });
});
