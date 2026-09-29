import { useEffect, useState } from 'react';
import type { AboutView } from '../../main/ipc';
import { api } from '../lib/api';

export function AboutSection() {
  const [about, setAbout] = useState<AboutView | null>(null);
  useEffect(() => { api.about().then(setAbout).catch((e) => console.error('[renderer] about failed:', e)); }, []);
  if (!about) return null;
  return (
    <div className="grp">
      <h4>About</h4>
      <div className="srow"><p>Daylens {about.version}<small>{about.credits.join(' ')}</small></p></div>
    </div>
  );
}
