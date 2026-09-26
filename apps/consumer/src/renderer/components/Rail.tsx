import { Icon } from './Icon';

export type Route = 'today' | 'reports' | 'settings';

export function Rail({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <aside className="rail">
      <div className="logo"><Icon name="sun" /></div>
      <button className={`nav${route === 'today' ? ' on' : ''}`} title="Today" aria-label="Today" onClick={() => onNavigate('today')}><Icon name="home" /></button>
      <button className={`nav${route === 'reports' ? ' on' : ''}`} title="Reports" aria-label="Reports" onClick={() => onNavigate('reports')}><Icon name="report" /></button>
      <div className="spacer" />
      <button className={`nav${route === 'settings' ? ' on' : ''}`} title="Settings" aria-label="Settings" onClick={() => onNavigate('settings')}><Icon name="settings" /></button>
    </aside>
  );
}
