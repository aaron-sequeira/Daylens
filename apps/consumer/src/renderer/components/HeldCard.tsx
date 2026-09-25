import { useEffect, useState } from 'react';
import type { CoachView } from '../../main/ipc';
import { NUDGE_LOOK } from '../../shared/nudgeLook';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';

export function HeldCard() {
  const [held, setHeld] = useState<CoachView['held']>([]);
  useEffect(() => {
    const load = (): void => { api.coach.get().then((v) => setHeld(v.held)).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!held.length) return null;
  return (
    <div className="held" role="region" aria-label="While you were busy">
      <p className="sec">While you were busy</p>
      {held.map((h) => (
        <div key={h.id} className="held-row" style={{ ['--c' as string]: NUDGE_LOOK[h.kind].color }}>
          <span className="held-ic" aria-hidden="true">{NUDGE_LOOK[h.kind].emoji}</span>
          <div><b>{h.title}</b><p>{h.body} <small>{formatClock(h.at)}</small></p></div>
          <button className="btn s" aria-label={`Dismiss ${h.title}`} onClick={() => { api.coach.dismissHeld(h.id).then((v) => setHeld(v.held)).catch(() => {}); }}>✕</button>
        </div>
      ))}
    </div>
  );
}
