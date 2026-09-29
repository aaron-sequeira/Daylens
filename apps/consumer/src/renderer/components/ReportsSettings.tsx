import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export function ReportsSettings() {
  const [folder, setFolder] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  // shareGet is re-fetched on every eventsUpdate push; an in-flight load whose reply lands after a later
  // choose()/clear() (or a newer load()) must not clobber that newer state with a stale folder/lastError.
  const seq = useRef(0);
  const load = (): void => {
    const mySeq = ++seq.current;
    api.reports.shareGet().then((v) => {
      if (seq.current !== mySeq) return; // a newer load/choose/clear has since landed; drop this stale reply
      setFolder(v.folder); setLastError(v.lastError);
    }).catch((e) => console.error('[renderer] reports.shareGet failed:', e));
  };
  useEffect(() => { load(); const off = api.onUpdate(load); return off; }, []);

  const choose = (): void => {
    ++seq.current; // invalidate any in-flight load(): this choice wins regardless of what it was about to set
    api.reports.choosePdfFolder().then((v) => setFolder(v.folder)).catch((e) => console.error('[renderer] reports.choosePdfFolder failed:', e));
  };
  const clear = (): void => {
    ++seq.current;
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
