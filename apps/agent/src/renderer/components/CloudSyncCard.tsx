import { useEffect, useState } from 'react';
import type { CloudSyncStatus } from '../../shared/types';
import { api } from '../lib/ipc';

export function CloudSyncCard() {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setStatus(await api.cloud.getStatus());
  useEffect(() => { void refresh(); }, []);

  async function signIn() {
    setBusy(true); setError(null);
    const r = await api.cloud.signIn(email, password);
    setBusy(false); setPassword('');
    if ('error' in r) { setError(r.error); return; }
    await refresh();
  }
  async function syncNow() {
    setBusy(true); setError(null);
    const r = await api.cloud.syncNow();
    setBusy(false);
    if ('error' in r) setError(r.error);
    await refresh();
  }

  if (!status) return null;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="text-sm font-medium">Cloud sync</div>
      <p className="text-xs text-gray-500">Optional. Only your aggregated daily totals (apps, time, active/idle) are sent — never window titles or keystrokes. Off by default.</p>

      {!status.connected ? (
        <div className="space-y-2">
          <input type="email" placeholder="WorkSight email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border px-2 py-1 text-sm" />
          <button disabled={busy} onClick={signIn} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">Connect to WorkSight</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">Connected as <span className="font-medium">{status.email}</span></div>
          <label className="flex items-center justify-between">
            <span className="text-sm">Enable automatic sync</span>
            <input type="checkbox" checked={status.enabled} onChange={async (e) => { await api.cloud.setEnabled(e.target.checked); await refresh(); }} />
          </label>
          <div className="flex items-center gap-2">
            <button disabled={busy} onClick={syncNow} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">{busy ? 'Syncing…' : 'Sync now'}</button>
            <button onClick={async () => { await api.cloud.signOut(); await refresh(); }} className="rounded border px-3 py-1 text-sm text-gray-600">Disconnect</button>
          </div>
          <div className="text-xs text-gray-500">
            {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
