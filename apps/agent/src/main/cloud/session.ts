import type { CloudConfig } from './config';
import type { CloudSession } from '../../shared/types';
import { signInWithPassword as restSignIn, refreshSession as restRefresh, type FetchFn } from './client';

export interface SessionStore { get(): CloudSession | null; set(s: CloudSession | null): void; }
interface ClientLike {
  signInWithPassword(f: FetchFn, cfg: CloudConfig, email: string, password: string): Promise<{ session: CloudSession } | { error: string }>;
  refreshSession(f: FetchFn, cfg: CloudConfig, refreshToken: string): Promise<{ session: CloudSession } | { error: string }>;
}
export interface SessionDeps {
  fetchFn: FetchFn; config: CloudConfig; store: SessionStore; now: () => number;
  // test-only override: a client whose methods ignore (f,cfg)
  client?: { signInWithPassword(...a: unknown[]): Promise<{ session: CloudSession } | { error: string }>; refreshSession(...a: unknown[]): Promise<{ session: CloudSession } | { error: string }>; };
}
export interface SessionManager {
  signIn(email: string, password: string): Promise<{ ok: true } | { error: string }>;
  signOut(): void;
  getAccount(): { userId: string; email: string } | null;
  getValidAccessToken(): Promise<string | null>;
}

const REFRESH_SKEW_SEC = 60;

export function createSessionManager(deps: SessionDeps): SessionManager {
  const real: ClientLike = { signInWithPassword: restSignIn, refreshSession: restRefresh };
  const callSignIn = (email: string, password: string) =>
    (deps.client ? deps.client.signInWithPassword(email, password) : real.signInWithPassword(deps.fetchFn, deps.config, email, password));
  const callRefresh = (rt: string) =>
    (deps.client ? deps.client.refreshSession(rt) : real.refreshSession(deps.fetchFn, deps.config, rt));

  return {
    async signIn(email, password) {
      const r = await callSignIn(email, password);
      if ('error' in r) return { error: r.error };
      deps.store.set(r.session);
      return { ok: true };
    },
    signOut() { deps.store.set(null); },
    getAccount() {
      const s = deps.store.get();
      return s ? { userId: s.userId, email: s.email } : null;
    },
    async getValidAccessToken() {
      const s = deps.store.get();
      if (!s) return null;
      if (s.expiresAt - deps.now() / 1000 > REFRESH_SKEW_SEC) return s.accessToken;
      const r = await callRefresh(s.refreshToken);
      if ('error' in r) return null;
      deps.store.set(r.session);
      return r.session.accessToken;
    }
  };
}
