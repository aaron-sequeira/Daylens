import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { appColor, appInitials } from '../lib/format';
import { displayAppName } from '../../shared/categories';

// One icon request per app for the life of the window; every badge for that app shares it.
const icons = new Map<string, Promise<string | null>>();
const iconFor = (name: string): Promise<string | null> => {
  let p = icons.get(name);
  if (!p) { p = api.appIcon(name).catch(() => null); icons.set(name, p); }
  return p;
};

/** The app's real Windows icon; coloured initials while it loads or when the app has none. */
export function AppBadge({ name, className }: { name: string; className?: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setIcon(null);
    void iconFor(name).then((i) => { if (live) setIcon(i); });
    return () => { live = false; };
  }, [name]);
  return (
    <b className={[className, icon ? 'has-icon' : ''].filter(Boolean).join(' ') || undefined} title={displayAppName(name)}
      style={icon ? undefined : { background: appColor(name) }}>
      {icon ? <img src={icon} alt="" draggable={false} /> : appInitials(name)}
    </b>
  );
}
