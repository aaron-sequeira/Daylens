import { ANIMATIONS, ANIMATION_LOOK, BREAK_OPTIONS, LIMITS, validateReminder, type ReminderInput } from '../../shared/reminders';
import { SCENES } from '../../shared/scenes';
import { breakLabel } from '../lib/reminderForm';

const DAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [7, 'S']] as const;
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ReminderEditor({ value, error, onChange, onSave, onCancel }: {
  value: ReminderInput; error: string | null; onChange: (v: ReminderInput) => void; onSave: () => void; onCancel: () => void;
}) {
  const localError = validateReminder(value);
  const s = value.schedule;
  const set = (p: Partial<ReminderInput>): void => onChange({ ...value, ...p });
  return (
    <div className="rem-editor" role="group" aria-label={value.id ? 'Edit reminder' : 'New reminder'}>
      <h5>{value.id ? 'Edit reminder' : 'New reminder'}</h5>
      <label>Name<input type="text" maxLength={LIMITS.name} value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Take vitamins" /></label>
      <label>Message<input type="text" maxLength={LIMITS.message} value={value.message} onChange={(e) => set({ message: e.target.value })} placeholder="Optional" /></label>
      <fieldset className="rem-when"><legend>When</legend>
        <label><input type="radio" checked={s.type === 'time'} onChange={() => set({ schedule: { type: 'time', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] } })} /> At a time</label>
        <label><input type="radio" checked={s.type === 'interval'} onChange={() => set({ schedule: { type: 'interval', minutes: 60 } })} /> Every … minutes of screen time</label>
        {s.type === 'time' ? (
          <div className="rem-time">
            <input type="time" aria-label="Time" value={s.time} onChange={(e) => set({ schedule: { ...s, time: e.target.value } })} />
            <div className="rem-days">{DAYS.map(([d, l]) => (
              <button key={d} type="button" className={`chip${s.days.includes(d) ? ' on' : ''}`} aria-label={DAY_NAMES[d]} aria-pressed={s.days.includes(d)}
                onClick={() => set({ schedule: { ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] } })}>{l}</button>
            ))}</div>
          </div>
        ) : (
          <input type="number" aria-label="Minutes" min={LIMITS.intervalMin} max={LIMITS.intervalMax} step={5} value={s.minutes}
            onChange={(e) => set({ schedule: { type: 'interval', minutes: Number(e.target.value) } })} />
        )}
      </fieldset>
      <label>Break<select value={value.breakSec} onChange={(e) => set({ breakSec: Number(e.target.value) })}>
        {BREAK_OPTIONS.map((b) => <option key={b} value={b}>{breakLabel(b)}</option>)}
      </select></label>
      <fieldset><legend>Animation</legend>
        <div className="gal">{ANIMATIONS.map((a) => (
          <button key={a} type="button" className={`gal-tile${value.animation === a ? ' on' : ''}`} aria-pressed={value.animation === a} aria-label={ANIMATION_LOOK[a].label} onClick={() => set({ animation: a })}>
            {/* static SVG from shared/scenes.ts — never user input */}
            <span className="gal-scene" dangerouslySetInnerHTML={{ __html: SCENES[a] }} />
            <span>{ANIMATION_LOOK[a].label}</span>
          </button>
        ))}</div>
      </fieldset>
      {/* Don't open with a complaint: local hints appear once there's a name to judge (Save stays disabled meanwhile). */}
      {(error || (localError && value.name.trim())) && <p className="srow-note" role="alert">{error ?? localError}</p>}
      <div className="btn-row"><button className="btn s" onClick={onCancel}>Cancel</button><button className="btn" disabled={localError !== null} onClick={onSave}>Save</button></div>
    </div>
  );
}
