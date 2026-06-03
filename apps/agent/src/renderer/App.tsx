import { useEffect, useState, useCallback } from 'react';
import type { AppSettings } from '../shared/types';
import { api } from './lib/ipc';
import { ConsentGate } from './components/ConsentGate';
import { TodayView } from './components/TodayView';
import { SettingsView } from './components/SettingsView';

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<'today' | 'settings'>('today');

  const refreshSettings = useCallback(async () => setSettings(await api.settings.get()), []);
  useEffect(() => { void refreshSettings(); }, [refreshSettings]);

  if (!settings) return <div className="p-8 text-gray-500">Loading…</div>;

  if (!settings.consentGranted) {
    return <ConsentGate onAccept={async () => { await api.settings.set({ consentGranted: true }); await api.tracking.resume(); await refreshSettings(); }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
        <span className="font-semibold">WorkSight</span>
        <nav className="flex gap-2">
          <button onClick={() => setTab('today')} className={`rounded px-3 py-1 text-sm ${tab === 'today' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Today</button>
          <button onClick={() => setTab('settings')} className={`rounded px-3 py-1 text-sm ${tab === 'settings' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Settings</button>
        </nav>
      </header>
      <main className="p-6">
        {tab === 'today' ? <TodayView /> : <SettingsView settings={settings} onChange={refreshSettings} />}
      </main>
    </div>
  );
}
