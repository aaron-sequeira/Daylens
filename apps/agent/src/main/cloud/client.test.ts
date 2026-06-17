import { describe, it, expect } from 'vitest';
import { signInWithPassword, refreshSession, upsertDailyActivity } from './client';
import type { DailyActivityRow } from '../../shared/types';

const cfg = { url: 'http://cloud.test', anonKey: 'ANON' };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('signInWithPassword', () => {
  it('posts to the token endpoint and maps the session', async () => {
    const { f, calls } = fakeFetch(200, { access_token: 'AT', refresh_token: 'RT', expires_at: 1000, user: { id: 'u1', email: 'a@x.test' } });
    const r = await signInWithPassword(f, cfg, 'a@x.test', 'pw');
    expect(r).toEqual({ session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000, userId: 'u1', email: 'a@x.test' } });
    expect(calls[0].url).toBe('http://cloud.test/auth/v1/token?grant_type=password');
    expect((calls[0].init.headers as Record<string, string>)['apikey']).toBe('ANON');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'a@x.test', password: 'pw' });
  });

  it('returns an error on bad credentials', async () => {
    const { f } = fakeFetch(400, { error_description: 'Invalid login credentials' });
    const r = await signInWithPassword(f, cfg, 'a@x.test', 'wrong');
    expect(r).toEqual({ error: 'Invalid login credentials' });
  });
});

describe('refreshSession', () => {
  it('posts to the refresh endpoint and maps the session', async () => {
    const { f, calls } = fakeFetch(200, { access_token: 'AT2', refresh_token: 'RT2', expires_at: 2000, user: { id: 'u1', email: 'a@x.test' } });
    const r = await refreshSession(f, cfg, 'RT');
    expect(r).toEqual({ session: { accessToken: 'AT2', refreshToken: 'RT2', expiresAt: 2000, userId: 'u1', email: 'a@x.test' } });
    expect(calls[0].url).toBe('http://cloud.test/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ refresh_token: 'RT' });
  });
});

describe('upsertDailyActivity', () => {
  const rows: DailyActivityRow[] = [{ user_id: 'u1', date: '2026-06-17', total_tracked_sec: 1, active_sec: 1, idle_sec: 0, by_app: [] }];
  it('posts rows to PostgREST with the on_conflict + merge headers', async () => {
    const { f, calls } = fakeFetch(201, null);
    const r = await upsertDailyActivity(f, cfg, 'AT', rows);
    expect(r).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://cloud.test/rest/v1/daily_activity?on_conflict=user_id,date');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer AT');
    expect(h['apikey']).toBe('ANON');
    expect(h['Prefer']).toBe('resolution=merge-duplicates,return=minimal');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(rows);
  });
  it('returns an error string on non-2xx', async () => {
    const { f } = fakeFetch(403, { message: 'permission denied' });
    const r = await upsertDailyActivity(f, cfg, 'AT', rows);
    expect(r).toEqual({ error: 'permission denied' });
  });
});
