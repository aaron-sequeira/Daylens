import { useEffect, useState } from 'react';
import type { WriterView } from '../../main/report/view';
import { api } from '../lib/api';
import { writerStatusText } from '../lib/writer';
import { CloudSetup } from './CloudSetup';

export function WriterSection() {
  const [view, setView] = useState<WriterView | null>(null);
  const load = (): void => { api.writer.get().then(setView).catch((e) => console.error('[renderer] writer.get failed:', e)); };
  useEffect(() => { load(); const off = api.onUpdate(load); return off; }, []);
  if (!view) return null;
  const act = (p: Promise<WriterView>): void => { p.then(setView).catch((e) => { console.error(e); load(); }); };
  const s = view.state;
  return (
    <div className="grp">
      <h4>Report writer</h4>
      <div className="srow">
        <p>Writer<small role="status">{writerStatusText(s)}</small><small>{view.attribution}</small></p>
        <div className="srow-btns">
          <button className={`btn s${view.mode === 'local' ? ' on' : ''}`} aria-pressed={view.mode === 'local'} onClick={() => act(api.writer.setMode('local'))}>On this PC</button>
          <button className={`btn s${view.mode === 'cloud' ? ' on' : ''}`} aria-pressed={view.mode === 'cloud'} onClick={() => act(api.writer.setMode('cloud'))}>Cloud</button>
        </div>
      </div>
      {view.mode === 'local' && (
        <div className="srow">
          <p>Model size<small>Recommended for this PC: {view.autoTier === '4b' ? 'Qwen3 4B' : 'Qwen3 1.7B'}</small></p>
          <div className="srow-btns">
            <select aria-label="Writer model size" value={view.tier} onChange={(e) => act(api.writer.setTier(e.target.value as '' | '4b' | '1.7b'))}>
              <option value="">Automatic</option><option value="4b">Qwen3 4B (better, 2.5 GB)</option><option value="1.7b">Qwen3 1.7B (lighter, 1.1 GB)</option>
            </select>
            {s.state === 'missing' && <button className="btn s" onClick={() => act(api.writer.download())}>Download</button>}
            {s.state === 'unavailable' && <button className="btn s" onClick={() => act(api.writer.retryLocal())}>Try local again</button>}
            {(s.state === 'ready' && s.mode === 'local') && <button className="btn s danger" onClick={() => act(api.writer.remove())}>Delete model</button>}
          </div>
        </div>
      )}
      {(view.mode === 'cloud' || s.state === 'unavailable') && <CloudSetup view={view} onSaved={setView} />}
    </div>
  );
}
