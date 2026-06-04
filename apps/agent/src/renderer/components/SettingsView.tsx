import { useState } from 'react';
import type { AppSettings, AiProvider } from '../../shared/types';
import { api } from '../lib/ipc';
import { PROVIDERS, providerMeta } from '../lib/providers';

export function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const meta = providerMeta(settings.aiProvider);

  async function patch(p: Partial<AppSettings>) { await api.settings.set(p); await onChange(); }

  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>

      <label className="flex items-center justify-between rounded-xl border bg-white p-4">
        <span className="text-sm">Idle threshold (seconds)</span>
        <input type="number" min={10} defaultValue={settings.idleThresholdSec}
          onBlur={(e) => patch({ idleThresholdSec: Number(e.target.value) })}
          className="w-24 rounded border px-2 py-1 text-sm" />
      </label>

      <label className="flex items-center justify-between rounded-xl border bg-white p-4">
        <span className="text-sm">Capture window titles</span>
        <input type="checkbox" checked={settings.captureWindowTitles}
          onChange={(e) => patch({ captureWindowTitles: e.target.checked })} />
      </label>

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <label className="flex items-center justify-between">
          <span className="text-sm">Enable AI summary</span>
          <input type="checkbox" checked={settings.aiEnabled} onChange={(e) => patch({ aiEnabled: e.target.checked })} />
        </label>

        <label className="block">
          <span className="text-sm text-gray-600">Provider</span>
          <select value={settings.aiProvider}
            onChange={(e) => { const p = e.target.value as AiProvider; void patch({ aiProvider: p, aiModel: providerMeta(p).defaultModel }); }}
            className="mt-1 w-full rounded border px-2 py-1 text-sm">
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <input type="password" placeholder={settings.hasApiKey ? 'Key saved — enter to replace' : `${meta.label} API key`}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1 rounded border px-2 py-1 text-sm" />
          <button onClick={async () => { await api.settings.setApiKey(apiKey); setApiKey(''); await onChange(); }}
            className="rounded bg-black px-3 py-1 text-sm text-white">Save key</button>
        </div>

        <label className="block">
          <span className="text-sm text-gray-600">Model</span>
          <input key={settings.aiProvider} type="text" defaultValue={settings.aiModel}
            onBlur={(e) => patch({ aiModel: e.target.value })}
            className="mt-1 w-full rounded border px-2 py-1 text-sm" />
        </label>

        {meta.custom && (
          <label className="block">
            <span className="text-sm text-gray-600">Base URL</span>
            <input key={`${settings.aiProvider}-url`} type="text" defaultValue={settings.aiBaseUrl} placeholder="https://…/v1"
              onBlur={(e) => patch({ aiBaseUrl: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm" />
          </label>
        )}

        {settings.hasApiKey
          ? <div className="text-xs text-green-700">A {meta.label} key is saved.</div>
          : meta.keyUrl ? <div className="text-xs text-gray-500">Get a {meta.label} key at {meta.keyUrl.replace('https://', '')}</div> : null}
      </div>

      <button onClick={async () => { if (confirm('Delete all tracked data?')) { await api.data.clearAll(); await onChange(); } }}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700">Clear all data</button>
    </div>
  );
}
