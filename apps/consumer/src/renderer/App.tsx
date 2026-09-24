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
    const load = (): void => { api.settings.get().then(setSettings).catch((e) => console.error('[renderer] settings.get failed:', e)); };
    load();
    return api.onUpdate(load); // tray pause/resume
  }, []);

  if (!settings) return <TitleBar tracking={null} />;
  if (!settings.consentGranted) {
    return (<><TitleBar tracking={null} /><Consent onAccept={() => { api.consent.grant().then(setSettings).catch((e) => console.error('[renderer] consent.grant failed:', e)); }} /></>);
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
