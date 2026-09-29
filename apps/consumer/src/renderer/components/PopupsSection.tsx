import { useEffect, useState } from 'react';
import type { CoachView } from '../../main/ipc';
import { NUDGE_LOOK } from '../../shared/nudgeLook';
import { api } from '../lib/api';
import { LIMIT_CHOICES, addLimit, limitSuggestions, snoozeText } from '../lib/coach';
import { formatHm } from '../lib/format';

const KIND_TEXT = { health: 'Eye breaks, stretching, wind-down, daily goal', behaviour: 'Doom-scrolling, scattered, app limits', tip: 'Short tips when you seem stuck', win: 'Deep-work streaks and good days', reminder: 'Water, meals, tea and your own reminders' } as const;

export function PopupsSection() {
  const [view, setView] = useState<CoachView | null>(null);
  const [distractions, setDistractions] = useState<string[]>([]);
  const [app, setApp] = useState('');
  const [minutes, setMinutes] = useState(60);
  const load = (): void => { api.coach.get().then(setView).catch((e) => console.error('[renderer] coach.get failed:', e)); };
  useEffect(() => {
    load();
    api.profile.get().then((p) => setDistractions(p.distractions)).catch(() => {});
    return api.onUpdate(load);
  }, []);
  if (!view) return null;
  const save = (p: Promise<CoachView>): void => { p.then(setView).catch((e) => { console.error(e); load(); }); };
  const add = (name: string): void => {
    const next = addLimit(view.limits, name, minutes);
    setApp('');
    if (next !== view.limits) save(api.coach.setLimits(next));
  };

  return (
    <div className="grp">
      <h4>Pop-ups</h4>
      {(Object.keys(NUDGE_LOOK) as (keyof typeof NUDGE_LOOK)[]).map((k) => (
        <div className="srow" key={k}>
          <p>{NUDGE_LOOK[k].emoji} {NUDGE_LOOK[k].label}<small>{KIND_TEXT[k]}</small></p>
          <button className={`sw${view.kinds[k] ? ' on' : ''}`} aria-label={`${NUDGE_LOOK[k].label} pop-ups`} aria-pressed={view.kinds[k]}
            onClick={() => save(api.coach.setKinds({ ...view.kinds, [k]: !view.kinds[k] }))} />
        </div>
      ))}
      <div className="srow">
        <p>Snooze<small role="status">{snoozeText(view.snoozeUntil, Date.now())}</small></p>
        <div className="srow-btns">
          <button className="btn s" onClick={() => save(api.coach.snooze('1h'))}>1 hour</button>
          <button className="btn s" onClick={() => save(api.coach.snooze('tomorrow'))}>Until tomorrow</button>
          {view.snoozeUntil > Date.now() && <button className="btn s" onClick={() => save(api.coach.snooze('off'))}>Turn back on</button>}
        </div>
      </div>
      <div className="srow stack">
        <p>Daily limits<small>A pop-up tells you when you pass a limit. Nothing is blocked.</small></p>
        <div className="xchips">
          {view.limits.map((l) => (
            <span key={l.app} className="xchip">{l.app} · {formatHm(l.minutes * 60)}
              <button aria-label={`Remove limit for ${l.app}`} onClick={() => save(api.coach.setLimits(view.limits.filter((x) => x !== l)))}>×</button>
            </span>
          ))}
        </div>
        <div className="xadd">
          <input type="text" aria-label="App to limit" placeholder="App name, e.g. Discord" maxLength={60} value={app}
            onChange={(e) => setApp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add(app); }} />
          <select aria-label="Daily limit" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {LIMIT_CHOICES.map((m) => <option key={m} value={m}>{formatHm(m * 60)}</option>)}
          </select>
          <button className="btn s" onClick={() => add(app)}>Add</button>
        </div>
        {limitSuggestions(distractions, view.limits).length > 0 && (
          <div className="xchips">
            {limitSuggestions(distractions, view.limits).map((d) => <button key={d} className="btn s" onClick={() => add(d)}>+ {d}</button>)}
          </div>
        )}
      </div>
      <div className="srow">
        <p>See what a pop-up looks like<small>Shows a sample in the top-right corner.</small></p>
        <button className="btn s" onClick={() => { void api.coach.test(); }}>Test a pop-up</button>
      </div>
    </div>
  );
}
