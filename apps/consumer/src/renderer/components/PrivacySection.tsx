import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../../main/settings';
import type { PrivacyView } from '../../main/ipc';
import { DEFAULT_EXCLUSIONS, MAX_PATTERN, addExclusion } from '../../shared/exclusions';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';

const STATUS_TEXT: Record<PrivacyView['ocrStatus'], string> = {
  off: 'Off', starting: 'Starting…', ready: 'Working', restarting: 'Restarting after an error…',
  'no-language': 'Windows has no text-recognition language installed',
  failed: 'Stopped after repeated errors. Turn it off and on to retry.'
};

export function PrivacySection({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const load = (): void => { api.privacy.get().then(setView).catch((e) => console.error('[renderer] privacy.get failed:', e)); };
  useEffect(() => {
    load();
    const off = api.onUpdate(load);
    const t = setInterval(load, 30_000);
    return () => { off(); clearInterval(t); };
  }, [settings.screenReading, settings.rawTextRetentionDays, settings.trackingPaused]);

  const set = async (patch: { screenReading?: boolean; rawTextRetentionDays?: 1 | 7 | 30 }): Promise<void> => {
    try { onChange(await api.settings.set(patch)); } catch (e) { console.error(e); load(); }
  };
  const saveExclusions = async (list: string[]): Promise<void> => {
    try { setView(await api.privacy.setExclusions(list)); } catch (e) { console.error(e); load(); }
  };
  const add = (): void => {
    if (!view) return;
    const next = addExclusion(view.exclusions, draft);
    setDraft('');
    if (next !== view.exclusions) void saveExclusions(next);
  };

  if (!view) return null;
  const status = settings.trackingPaused && view.screenReading ? 'Paused (tracking is paused)' : STATUS_TEXT[view.ocrStatus];

  return (
    <>
      <div className="grp">
        <h4>Screen reading</h4>
        <div className="srow">
          <p>Read on-screen text
            <small>Reads the text of the window in front every 30 seconds so Daylens can understand what you're doing. The screenshot is never saved; only the text is kept, on this PC.</small>
          </p>
          <button className={`sw${view.screenReading ? ' on' : ''}`} aria-label="Read on-screen text" aria-pressed={view.screenReading}
            onClick={() => { void set({ screenReading: !view.screenReading }); }} />
        </div>
        <div className="srow">
          <p className="privacy-status" role="status">Status: <b>{status}</b></p>
          {view.ocrStatus === 'no-language' && (
            <button className="btn s" onClick={() => { void api.privacy.openLanguageSettings(); }}>Install a language</button>
          )}
        </div>
        <div className="srow">
          <p>Keep screen text for<small>Older text is erased automatically. Time and app history are kept.</small></p>
          <div className="segc" role="group" aria-label="Keep screen text for">
            {([1, 7, 30] as const).map((d) => (
              <button key={d} aria-pressed={view.retentionDays === d} onClick={() => { void set({ rawTextRetentionDays: d }); }}>
                {d === 1 ? '1 day' : `${d} days`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grp">
        <h4>Never look at</h4>
        <div className="srow stack">
          <p><small>Nothing is read while one of these words appears in the app name or window title.</small></p>
          <div className="xchips">
            {view.exclusions.map((p) => (
              <span key={p} className="xchip">{p}
                <button aria-label={`Remove ${p}`} onClick={() => { void saveExclusions(view.exclusions.filter((x) => x !== p)); }}>×</button>
              </span>
            ))}
          </div>
          <div className="xadd">
            <input type="text" aria-label="Add an app or word to never look at" placeholder="Add an app or word…" maxLength={MAX_PATTERN} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add(); }} />
            <button className="btn s" onClick={add}>Add</button>
            <button className="btn s" onClick={() => { void saveExclusions([...DEFAULT_EXCLUSIONS]); }}>Restore defaults</button>
          </div>
        </div>
      </div>

      <div className="grp">
        <h4>See it for yourself</h4>
        <div className="srow stack">
          {view.lastRead ? (
            <>
              <p><small>Last read at {formatClock(view.lastRead.at)} · {view.lastRead.app}{view.lastRead.title ? ` · ${view.lastRead.title}` : ''}. This is exactly what was stored.</small></p>
              <pre className="peek">{view.lastRead.text || '(no text found)'}</pre>
            </>
          ) : <p><small>Nothing read yet.</small></p>}
        </div>
      </div>

      <div className="grp">
        <h4>Your data</h4>
        <div className="srow">
          <p>Export everything<small>A JSON file with your activity, screen reads, settings and answers.</small></p>
          <button className="btn s" onClick={() => {
            api.privacy.export().then((r) => setNote(r.saved ? `Saved to ${r.path}` : null)).catch((e) => { console.error(e); setNote("Couldn't save the export."); });
          }}>Export</button>
        </div>
        <div className="srow">
          <p>Delete my activity<small>Erases screen time, app history and screen reads from this PC. Settings and answers are kept.</small></p>
          <button className="btn s danger" onClick={() => {
            api.privacy.deleteActivity().then((r) => { if (r.deleted) { setNote('Your activity was deleted.'); load(); } }).catch((e) => { console.error(e); setNote("Couldn't delete your activity."); });
          }}>Delete…</button>
        </div>
        {note && <p className="srow-note" role="status">{note}</p>}
      </div>
    </>
  );
}
