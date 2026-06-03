import { useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { api } from '../lib/ipc';

export function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');

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
        <div className="flex items-center gap-2">
          <input type="password" placeholder={settings.hasApiKey ? 'Key saved — enter to replace' : 'Anthropic API key'}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1 rounded border px-2 py-1 text-sm" />
          <button onClick={async () => { await api.settings.setApiKey(apiKey); setApiKey(''); await onChange(); }}
            className="rounded bg-black px-3 py-1 text-sm text-white">Save key</button>
        </div>
        <div className="text-xs text-gray-500">Model: {settings.aiModel}</div>
      </div>

      <button onClick={async () => { if (confirm('Delete all tracked data?')) { await api.data.clearAll(); await onChange(); } }}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700">Clear all data</button>
    </div>
  );
}
