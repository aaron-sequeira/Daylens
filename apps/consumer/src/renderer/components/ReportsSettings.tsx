import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function ReportsSettings() {
  const [folder, setFolder] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const load = (): void => {
    api.reports.shareGet().then((v) => { setFolder(v.folder); setLastError(v.lastError); })
      .catch((e) => console.error('[renderer] reports.shareGet failed:', e));
  };
  useEffect(() => { load(); const off = api.onUpdate(load); return off; }, []);

  const choose = (): void => {
    api.reports.choosePdfFolder().then((v) => setFolder(v.folder)).catch((e) => console.error('[renderer] reports.choosePdfFolder failed:', e));
  };
  const clear = (): void => {
    api.reports.clearPdfFolder().then((v) => { setFolder(v.folder); setLastError(null); }).catch((e) => console.error('[renderer] reports.clearPdfFolder failed:', e));
  };

  return (
    <div className="grp">
      <h4>Reports</h4>
      <div className="srow">
        <p>Auto-save PDFs<small>{folder || 'Off'}</small></p>
        <div className="srow-btns">
          <button className="btn s" onClick={choose}>Choose folder…</button>
          {folder && <button className="btn s" onClick={clear}>Turn off</button>}
        </div>
      </div>
      {lastError && <p className="cloud-error" role="alert">{lastError}</p>}
    </div>
  );
}
