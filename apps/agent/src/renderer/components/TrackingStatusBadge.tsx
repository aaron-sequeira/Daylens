import { useEffect, useState } from 'react';
import type { TrackingStatus } from '../../shared/types';
import { api } from '../lib/ipc';
import { formatDuration } from '../lib/format';
import { trackingDisplay } from '../lib/trackingStatus';

// Live "is it tracking right now" badge. Refreshes when the tracker emits an update
// (app switch / bucket flush) and ticks once a second so the elapsed time advances.
export function TrackingStatusBadge() {
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const refresh = async (): Promise<void> => setStatus(await api.tracking.getStatus());
    void refresh();
    const off = api.onUpdate(() => { void refresh(); });
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); clearInterval(id); };
  }, []);

  if (!status) return null;
  const d = trackingDisplay(status, now);
  const appLabel = d.appName && d.appName.length > 36 ? d.appName.slice(0, 35) + '…' : d.appName;

  const label = !d.active
    ? 'Paused'
    : appLabel
      ? `Tracking · ${appLabel}${d.elapsedSec != null ? ` · ${formatDuration(d.elapsedSec)}` : ''}`
      : 'Tracking · starting…';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
        d.active ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-200 bg-gray-50 text-gray-500'
      }`}
      title={d.active && d.appName ? d.appName : undefined}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${d.active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
      {label}
    </span>
  );
}
