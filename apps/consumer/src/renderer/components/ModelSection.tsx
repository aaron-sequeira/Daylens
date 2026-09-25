import { useEffect, useState } from 'react';
import type { DaylensSettings } from '../../main/settings';
import type { ModelsView } from '../../main/ipc';
import { api } from '../lib/api';
import { canRedownload, labellingText, modelHint, modelStatusText } from '../lib/models';

export function ModelSection({ settings }: { settings: DaylensSettings }) {
  const [view, setView] = useState<ModelsView | null>(null);
  const load = (): void => { api.models.get().then(setView).catch((e) => console.error('[renderer] models.get failed:', e)); };
  useEffect(() => {
    load();
    const off = api.onUpdate(load);
    const t = setInterval(load, 30_000);
    return () => { off(); clearInterval(t); };
  }, []);
  if (!view) return null;
  const act = (p: Promise<unknown>): void => { p.then(load).catch((e) => { console.error(e); load(); }); };
  const hint = modelHint(settings, view.model);

  return (
    <div className="grp">
      <h4>AI model</h4>
      <div className="srow">
        <p>Laya (on-device)<small role="status">{modelStatusText(view.model)}</small>{hint && <small>{hint}</small>}</p>
        <div className="srow-btns">
          {canRedownload(view.model) && <button className="btn s" onClick={() => act(api.models.redownload())}>Download again</button>}
          <button className="btn s danger" disabled={view.model.state === 'missing'} onClick={() => act(api.models.delete())}>Delete model</button>
        </div>
      </div>
      <div className="srow">
        <p>Labelling<small role="status">{labellingText(view.labelling)}{view.labelling.state !== 'deferred' && view.labelling.pending > 0 ? ` · ${view.labelling.pending} waiting` : ''}</small></p>
        {view.labelling.state === 'paused' && <button className="btn s" onClick={() => act(api.models.retryLabelling())}>Retry</button>}
      </div>
    </div>
  );
}
