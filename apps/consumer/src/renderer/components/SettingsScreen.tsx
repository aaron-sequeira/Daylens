import { useEffect, useRef, useState } from 'react';
import type { DaylensSettings, SettingsPatch } from '../../main/settings';
import { api } from '../lib/api';
import { formatHm } from '../lib/format';
import { MAX_TEXT, type Profile } from '../../shared/profileOptions';
import { profileSummary } from '../lib/onboardingContent';

const GOAL_DEBOUNCE_MS = 300;

export function SettingsScreen({ settings, onChange, onRedo }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void; onRedo: () => void }) {
  const save = async (patch: SettingsPatch): Promise<void> => {
    try {
      onChange(await api.settings.set(patch));
    } catch (err) {
      console.error(err);
      try { onChange(await api.settings.get()); } catch { /* stale UI beats a throw */ }
    }
  };
  const toggleTracking = async (): Promise<void> => {
    try {
      await api.tracking.set(settings.trackingPaused);
      onChange(await api.settings.get());
    } catch (err) {
      console.error(err);
      try { onChange(await api.settings.get()); } catch { /* stale UI beats a throw */ }
    }
  };

  const [profile, setProfile] = useState<Profile | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.profile.get()
      .then((p) => { if (alive) { setProfile(p); setNameDraft(p.name); } })
      .catch((e) => console.error('[renderer] profile.get failed:', e));
    return () => { alive = false; };
  }, [settings.profileName, settings.profileRoles, settings.profileGoals, settings.profileDistractions, settings.windDownTime]);

  const saveName = async (): Promise<void> => {
    if (!profile || nameDraft.trim().replace(/\s+/g, ' ') === profile.name) return;
    try {
      onChange(await api.profile.save({ ...profile, name: nameDraft }));
      setNameError(null);
    } catch (err) {
      console.error(err);
      setNameError('Names can be up to 40 characters, without special control characters.');
      setNameDraft(profile.name);
    }
  };

  // Local draft for the goal slider: updates live while dragging, and only
  // reaches disk (via `save`, which round-trips IPC + SQLite) after a short
  // pause, so dragging doesn't flood the main process with writes.
  const [goalHours, setGoalHours] = useState(settings.dailyGoalMin / 60);
  const goalHoursRef = useRef(goalHours);
  goalHoursRef.current = goalHours;
  const goalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goalPending = useRef(false);

  useEffect(() => {
    if (!goalPending.current) setGoalHours(settings.dailyGoalMin / 60);
  }, [settings.dailyGoalMin]);

  useEffect(() => () => {
    if (goalTimer.current) {
      clearTimeout(goalTimer.current);
      goalTimer.current = null;
      goalPending.current = false;
      void save({ dailyGoalMin: Math.round(goalHoursRef.current * 60) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitGoal = (hours: number): void => {
    setGoalHours(hours);
    goalPending.current = true;
    if (goalTimer.current) clearTimeout(goalTimer.current);
    goalTimer.current = setTimeout(() => {
      goalTimer.current = null;
      goalPending.current = false;
      void save({ dailyGoalMin: Math.round(hours * 60) });
    }, GOAL_DEBOUNCE_MS);
  };

  return (
    <main className="settings">
      <h1>Settings</h1>

      <div className="grp">
        <h4>About you</h4>
        <div className="srow">
          <p>Your name<small>Used to greet you on the Today screen.</small></p>
          <input type="text" aria-label="Your name" placeholder="Your first name" maxLength={MAX_TEXT} value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)} onBlur={() => { void saveName(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
        {nameError && <p className="srow-error" role="alert">{nameError}</p>}
        <div className="srow">
          <p>What Daylens knows about you<small>{profileSummary(profile)}</small></p>
          <button className="btn s" onClick={onRedo}>Redo the questions</button>
        </div>
      </div>

      <div className="grp">
        <h4>Tracking</h4>
        <div className="srow">
          <p>{settings.trackingPaused ? 'Tracking is paused' : 'Tracking is on'}<small>Pausing stops all recording until you resume. Also available from the tray icon.</small></p>
          <button className={`btn${settings.trackingPaused ? '' : ' s'}`} onClick={toggleTracking}>{settings.trackingPaused ? 'Resume' : 'Pause'}</button>
        </div>
        <div className="srow">
          <p>Record window titles<small>Shows which file or page you were on. Turn off to record app names only.</small></p>
          <button className={`sw${settings.captureWindowTitles ? ' on' : ''}`} aria-label="Record window titles" aria-pressed={settings.captureWindowTitles} onClick={() => save({ captureWindowTitles: !settings.captureWindowTitles })} />
        </div>
        <div className="srow">
          <p>Start with Windows<small>Opens quietly in the tray when you sign in.</small></p>
          <button className={`sw${settings.openAtLogin ? ' on' : ''}`} aria-label="Start with Windows" aria-pressed={settings.openAtLogin} onClick={() => save({ openAtLogin: !settings.openAtLogin })} />
        </div>
      </div>

      <div className="grp" style={{ animationDelay: '.08s' }}>
        <h4>Goals & health</h4>
        <div className="srow">
          <p>Daily screen-time goal: <b>{formatHm(Math.round(goalHours * 60) * 60)}</b><small>Your health score drops as you go past it.</small></p>
          <input type="range" min={2} max={12} step={0.5} value={goalHours} aria-label="Daily screen-time goal in hours"
            onChange={(e) => commitGoal(Number(e.target.value))} />
        </div>
        <div className="srow">
          <p>Wind down after<small>Screen use after this time (or before 5 am) counts as late-night use.</small></p>
          <input type="time" value={settings.windDownTime} aria-label="Wind-down time"
            onChange={(e) => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) void save({ windDownTime: e.target.value }); }} />
        </div>
        <div className="srow">
          <p>Take a break every<small>Used for the "breaks taken" part of your health score.</small></p>
          <select value={settings.breakIntervalMin} aria-label="Break interval" onChange={(e) => void save({ breakIntervalMin: Number(e.target.value) })}>
            {[30, 45, 50, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
      </div>
    </main>
  );
}
