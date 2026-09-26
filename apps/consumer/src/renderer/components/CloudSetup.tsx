import { useState } from 'react';
import type { AiProvider } from '@worksight/core/ai';
import type { WriterView } from '../../main/report/view';
import { api } from '../lib/api';
import { PROVIDERS } from '../lib/writer';

export function CloudSetup({ view, onSaved }: { view: WriterView; onSaved: (v: WriterView) => void }) {
  const [provider, setProvider] = useState(view.provider);
  const [model, setModel] = useState(view.model);
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const p = PROVIDERS.find((x) => x.id === provider) ?? PROVIDERS[0];
  const save = (): void => {
    setError('');
    api.writer.setCloud({ provider: provider as AiProvider, model: model.trim() || p.defaultModel, baseUrl: p.needsBaseUrl ? baseUrl.trim() : '', ...(key.trim() ? { key: key.trim() } : {}) })
      .then((v) => { setKey(''); onSaved(v); })
      .catch(() => setError('Check the model name, the base URL (https) and the key.'));
  };
  return (
    <div className="cloud-setup">
      <p className="cloud-note">Only a short summary of your day (numbers, app names, a few window titles) is sent. Screen text and screenshots never leave your PC.</p>
      <label>Provider
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(PROVIDERS.find((x) => x.id === e.target.value)?.defaultModel ?? ''); }}>
          {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label>Model<input type="text" value={model} placeholder={p.defaultModel} onChange={(e) => setModel(e.target.value)} /></label>
      {p.needsBaseUrl && <label>Base URL<input type="url" value={baseUrl} placeholder="https://…/v1" onChange={(e) => setBaseUrl(e.target.value)} /></label>}
      <label>API key<input type="password" value={key} autoComplete="off" placeholder={view.hasKey && provider === view.provider ? 'Saved (leave empty to keep)' : 'Paste your key'} onChange={(e) => setKey(e.target.value)} /></label>
      {error && <p className="cloud-error" role="alert">{error}</p>}
      <button className="btn" disabled={!key.trim() && !(view.hasKey && provider === view.provider)} onClick={save}>Use cloud</button>
    </div>
  );
}
