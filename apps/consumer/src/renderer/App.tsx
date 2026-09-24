import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../main/settings';
import { api } from './lib/api';
import { TitleBar } from './components/TitleBar';
import { Rail, type Route } from './components/Rail';
import { Consent } from './components/Consent';
import { TodayScreen } from './components/TodayScreen';
import { SettingsScreen } from './components/SettingsScreen';

export default function App() {
  const [settings, setSettings] = useState<DaylensSettings | null>(null);
  const [route, setRoute] = useState<Route>('today');

  useEffect(() => {
    void api.settings.get().then(setSettings);
    return api.onUpdate(() => void api.settings.get().then(setSettings)); // tray pause/resume
  }, []);

  if (!settings) return <TitleBar tracking={null} />;
  if (!settings.consentGranted) {
    return (<><TitleBar tracking={null} /><Consent onAccept={async () => setSettings(await api.consent.grant())} /></>);
  }
  return (
    <>
      <TitleBar tracking={!settings.trackingPaused} />
      <div className={`shell${route === 'settings' ? ' wide' : ''}`}>
        <Rail route={route} onNavigate={setRoute} />
        {route === 'today' ? <TodayScreen settings={settings} /> : <SettingsScreen settings={settings} onChange={setSettings} />}
      </div>
    </>
  );
}
