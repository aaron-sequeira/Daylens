import { useEffect, useState } from 'react';
import type { RemindersView } from '../../main/ipc';
import { ANIMATION_LOOK, LIMITS, reminderSummary, type Reminder, type ReminderInput } from '../../shared/reminders';
import { api } from '../lib/api';
import { emptyForm, formFrom } from '../lib/reminderForm';
import { ReminderEditor } from './ReminderEditor';

export function RemindersSection() {
  const [view, setView] = useState<RemindersView | null>(null);
  const [editing, setEditing] = useState<ReminderInput | null>(null);
  useEffect(() => { api.reminders.list().then(setView).catch((e) => console.error('[renderer] reminders.list failed:', e)); }, []);
  if (!view) return null;
  const apply = (p: Promise<RemindersView>): void => { p.then((v) => { setView(v); if (!v.error) setEditing(null); }).catch((e) => console.error(e)); };
  const custom = view.reminders.filter((r) => !r.builtin).length;
  return (
    <div className="grp">
      <h4>Reminders</h4>
      {view.reminders.map((r: Reminder) => (
        <div className="srow" key={r.id}>
          <p>{ANIMATION_LOOK[r.animation].emoji} {r.name}<small>{reminderSummary(r)}</small></p>
          <div className="srow-actions">
            <button className="btn s" onClick={() => { setEditing(formFrom(r)); setView({ ...view, error: null }); }}>Edit</button>
            {r.builtin
              ? <button className="btn s" onClick={() => apply(api.reminders.reset(r.builtin as 'water' | 'lunch' | 'tea' | 'dinner'))}>Reset</button>
              : <button className="btn s" onClick={() => apply(api.reminders.delete(r.id))}>Delete</button>}
            <button className={`sw${r.enabled ? ' on' : ''}`} aria-label={`${r.name} reminder`} aria-pressed={r.enabled} onClick={() => apply(api.reminders.setEnabled(r.id, !r.enabled))} />
          </div>
        </div>
      ))}
      {editing
        ? <ReminderEditor value={editing} error={view.error} onChange={setEditing} onCancel={() => { setEditing(null); setView({ ...view, error: null }); }} onSave={() => apply(api.reminders.save(editing))} />
        : <div className="srow"><p>Add your own<small>{custom} of {LIMITS.custom} used</small></p><button className="btn" disabled={custom >= LIMITS.custom} onClick={() => { setEditing(emptyForm()); setView({ ...view, error: null }); }}>Add reminder</button></div>}
    </div>
  );
}
