import type { CloudConfig } from './config';
import type { CloudSession, DailyActivityRow } from '../../shared/types';

export type FetchFn = typeof fetch;

interface TokenResponse { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string }; }

function toSession(t: TokenResponse): CloudSession {
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at, userId: t.user.id, email: t.user.email };
}

async function tokenRequest(f: FetchFn, cfg: CloudConfig, grant: 'password' | 'refresh_token', body: unknown): Promise<{ session: CloudSession } | { error: string }> {
  try {
    const res = await f(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error_description?: string; msg?: string; message?: string };
      return { error: e.error_description ?? e.msg ?? e.message ?? `HTTP ${res.status}` };
    }
    return { session: toSession(await res.json() as TokenResponse) };
  } catch (e) {
    return { error: String(e) };
  }
}

export function signInWithPassword(f: FetchFn, cfg: CloudConfig, email: string, password: string) {
  return tokenRequest(f, cfg, 'password', { email, password });
}

export function refreshSession(f: FetchFn, cfg: CloudConfig, refreshToken: string) {
  return tokenRequest(f, cfg, 'refresh_token', { refresh_token: refreshToken });
}

export async function upsertDailyActivity(f: FetchFn, cfg: CloudConfig, accessToken: string, rows: DailyActivityRow[]): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await f(`${cfg.url}/rest/v1/daily_activity?on_conflict=user_id,date`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { message?: string };
      return { error: e.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { error: String(e) };
  }
}
