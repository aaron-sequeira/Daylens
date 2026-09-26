import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function PlanCard() {
  const [items, setItems] = useState<{ id: number; text: string; enabled: boolean }[]>([]);
  useEffect(() => {
    const load = (): void => { api.plan.today().then(setItems).catch(() => {}); };
    load();
    return api.onUpdate(load);
  }, []);
  if (!items.length) return null;
  return (
    <div className="plan-card" role="region" aria-label="Today's plan">
      <p className="sec">Today's plan</p>
      {items.map((p) => (
        <div className="srow" key={p.id}>
          <p>{p.text}</p>
          <button className={`sw${p.enabled ? ' on' : ''}`} aria-label={p.text} aria-pressed={p.enabled}
            onClick={() => { api.plan.setEnabled(p.id, !p.enabled).then(setItems).catch(() => {}); }} />
        </div>
      ))}
    </div>
  );
}
