import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionManager } from './session';
import type { CloudSession } from '../../shared/types';

const cfg = { url: 'http://c.test', anonKey: 'ANON' };

function memStore() {
  let s: CloudSession | null = null;
  return { get: () => s, set: (v: CloudSession | null) => { s = v; }, peek: () => s };
}

describe('session manager', () => {
  let store: ReturnType<typeof memStore>;
  let now: number;
  beforeEach(() => { store = memStore(); now = 1_000_000; });

  it('signs in and persists the session', async () => {
    const client = {
      signInWithPassword: async () => ({ session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' } }),
      refreshSession: async () => ({ error: 'unused' })
    };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    const r = await m.signIn('a@x.test', 'pw');
    expect(r).toEqual({ ok: true });
    expect(store.peek()?.accessToken).toBe('AT');
    expect(m.getAccount()).toEqual({ userId: 'u1', email: 'a@x.test' });
  });

  it('returns a valid token without refreshing when not near expiry', async () => {
    store.set({ accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' });
    let refreshed = false;
    const client = { signInWithPassword: async () => ({ error: 'x' }), refreshSession: async () => { refreshed = true; return { error: 'x' }; } };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    expect(await m.getValidAccessToken()).toBe('AT');
    expect(refreshed).toBe(false);
  });

  it('refreshes and persists when the token is expiring', async () => {
    store.set({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: now / 1000 + 10, userId: 'u1', email: 'a@x.test' });
    const client = {
      signInWithPassword: async () => ({ error: 'x' }),
      refreshSession: async () => ({ session: { accessToken: 'NEW', refreshToken: 'RT2', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' } })
    };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    expect(await m.getValidAccessToken()).toBe('NEW');
    expect(store.peek()?.accessToken).toBe('NEW');
  });

  it('signOut clears the session', async () => {
    store.set({ accessToken: 'AT', refreshToken: 'RT', expiresAt: now / 1000 + 3600, userId: 'u1', email: 'a@x.test' });
    const client = { signInWithPassword: async () => ({ error: 'x' }), refreshSession: async () => ({ error: 'x' }) };
    const m = createSessionManager({ fetchFn: (async () => ({})) as never, config: cfg, store, now: () => now, client });
    m.signOut();
    expect(store.peek()).toBeNull();
    expect(m.getAccount()).toBeNull();
    expect(await m.getValidAccessToken()).toBeNull();
  });
});
