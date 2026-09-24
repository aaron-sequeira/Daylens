import type { DaylensSettings, SettingsPatch } from '../../main/settings';
import { api } from '../lib/api';
import { formatHm } from '../lib/format';

export function SettingsScreen({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const save = async (patch: SettingsPatch): Promise<void> => onChange(await api.settings.set(patch));
  const toggleTracking = async (): Promise<void> => {
    await api.tracking.set(settings.trackingPaused);
    onChange(await api.settings.get());
  };

  return (
    <main className="settings">
      <h1>Settings</h1>

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
          <p>Daily screen-time goal: <b>{formatHm(settings.dailyGoalMin * 60)}</b><small>Your health score drops as you go past it.</small></p>
          <input type="range" min={2} max={12} step={0.5} value={settings.dailyGoalMin / 60} aria-label="Daily screen-time goal in hours"
            onChange={(e) => void save({ dailyGoalMin: Math.round(Number(e.target.value) * 60) })} />
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
