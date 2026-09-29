import { Icon } from './Icon';
import { Logo } from './Logo';

export type Route = 'today' | 'reports' | 'insights' | 'settings';

export function Rail({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <aside className="rail">
      <div className="logo"><Logo variant="small" size={40} animate="app-open" /></div>
      <button className={`nav${route === 'today' ? ' on' : ''}`} title="Today" aria-label="Today" onClick={() => onNavigate('today')}><Icon name="home" /></button>
      <button className={`nav${route === 'reports' ? ' on' : ''}`} title="Reports" aria-label="Reports" onClick={() => onNavigate('reports')}><Icon name="report" /></button>
      <button className={`nav${route === 'insights' ? ' on' : ''}`} title="Insights" aria-label="Insights" onClick={() => onNavigate('insights')}><Icon name="insights" /></button>
      <div className="spacer" />
      <button className={`nav${route === 'settings' ? ' on' : ''}`} title="Settings" aria-label="Settings" onClick={() => onNavigate('settings')}><Icon name="settings" /></button>
    </aside>
  );
}
