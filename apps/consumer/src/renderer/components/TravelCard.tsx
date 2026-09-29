import { useEffect, useState } from 'react';
import type { TravelView } from '../../main/time/travel';
import { api } from '../lib/api';
import { travelHeadline } from '../lib/travel';

export function TravelCard() {
  const [view, setView] = useState<TravelView | null>(null);
  useEffect(() => {
    const load = (): void => { api.travel.get().then(setView).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!view) return null;
  return (
    <div className="travel" role="region" aria-label="Travel mode">
      <p className="sec">✈️ Travel mode</p>
      <b>{travelHeadline(view)}</b>
      <ul>{view.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      <button className="btn s" onClick={() => { api.travel.off().then(() => setView(null)).catch(() => {}); }}>Turn off travel mode</button>
    </div>
  );
}
