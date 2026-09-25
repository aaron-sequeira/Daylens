import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../main/settings';
import { DEFAULT_PROFILE, type Profile } from '../shared/profileOptions';
import { api } from './lib/api';
import { TitleBar } from './components/TitleBar';
import { Rail, type Route } from './components/Rail';
import { Onboarding } from './components/Onboarding';
import { TodayScreen } from './components/TodayScreen';
import { SettingsScreen } from './components/SettingsScreen';

type OnboardingState = { mode: 'first' | 'redo'; initial: Profile };

export default function App() {
  const [settings, setSettings] = useState<DaylensSettings | null>(null);
  const [route, setRoute] = useState<Route>('today');
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);

  useEffect(() => {
    const load = (): void => { api.settings.get().then(setSettings).catch((e) => console.error('[renderer] settings.get failed:', e)); };
    load();
    return api.onUpdate(load); // tray pause/resume
  }, []);

  const needsFirstRun = settings !== null && !settings.consentGranted;
  useEffect(() => {
    if (!needsFirstRun || onboarding) return;
    api.profile.get()
      .then((p) => setOnboarding({ mode: 'first', initial: p }))
      .catch((e) => { console.error('[renderer] profile.get failed:', e); setOnboarding({ mode: 'first', initial: DEFAULT_PROFILE }); });
  }, [needsFirstRun, onboarding]);

  const redo = (): void => {
    api.profile.get()
      .then((p) => setOnboarding({ mode: 'redo', initial: p }))
      .catch((e) => console.error('[renderer] profile.get failed:', e));
  };

  if (!settings) return <TitleBar tracking={null} />;
  if (onboarding) {
    const { mode, initial } = onboarding;
    return (
      <>
        <TitleBar tracking={settings.consentGranted ? !settings.trackingPaused : null} />
        <Onboarding mode={mode} initial={initial} initialScreen={settings.screenReading}
          onDone={(s) => { setSettings(s); setRoute(mode === 'redo' ? 'settings' : 'today'); setOnboarding(null); }}
          onCancel={mode === 'redo' ? () => setOnboarding(null) : undefined} />
      </>
    );
  }
  if (!settings.consentGranted) return <TitleBar tracking={null} />;
  return (
    <>
      <TitleBar tracking={!settings.trackingPaused} />
      <div className={`shell${route === 'settings' ? ' wide' : ''}`}>
        <Rail route={route} onNavigate={setRoute} />
        {route === 'today' ? <TodayScreen settings={settings} onChange={setSettings} /> : <SettingsScreen settings={settings} onChange={setSettings} onRedo={redo} />}
      </div>
    </>
  );
}
