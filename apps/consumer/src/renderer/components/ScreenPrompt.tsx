import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../../main/settings';
import type { ModelsView } from '../../main/ipc';
import { api } from '../lib/api';
import { bannerText, shouldAskScreenReading } from '../lib/models';

/** One-time opt-in card for existing users, plus a slim progress banner while the model downloads. */
export function ScreenPrompt({ settings, onChange }: { settings: DaylensSettings; onChange: (s: DaylensSettings) => void }) {
  const [models, setModels] = useState<ModelsView | null>(null);
  useEffect(() => {
    if (!settings.screenReading) { setModels(null); return; }
    const load = (): void => { api.models.get().then(setModels).catch((e) => console.error('[renderer] models.get failed:', e)); };
    load();
    const off = api.onUpdate(load);
    return off;
  }, [settings.screenReading]);

  const answer = (on: boolean): void => {
    api.settings.set(on ? { screenReading: true, screenReadingAsked: true } : { screenReadingAsked: true })
      .then(onChange).catch((e) => console.error('[renderer] settings.set failed:', e));
  };

  if (shouldAskScreenReading(settings)) {
    return (
      <div className="sp-card" role="region" aria-label="Screen reading">
        <span className="sp-ico" aria-hidden="true">👀</span>
        <div>
          <b>Let Daylens understand your screen?</b>
          <p>It reads the text of the window in front every 30 seconds to tell coding from scrolling. Text only, never screenshots, and it stays on this PC. Needs a one-time 1.7 GB download.</p>
        </div>
        <div className="sp-actions">
          <button className="btn s" onClick={() => answer(false)}>Not now</button>
          <button className="btn" onClick={() => answer(true)}>Turn on</button>
        </div>
      </div>
    );
  }
  const text = models ? bannerText(settings.screenReading, models.model, models.labelling) : null;
  return text ? <div className="sp-banner" role="status">{text}</div> : null;
}
