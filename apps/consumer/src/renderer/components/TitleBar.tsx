import { Icon } from './Icon';

export function TitleBar({ tracking }: { tracking: boolean | null }) {
  return (
    <div className="titlebar">
      <span style={{ width: 16, height: 16, display: 'inline-grid' }}><Icon name="sun" /></span>
      Daylens
      {tracking !== null && (
        <span className="status"><i className={`dot${tracking ? '' : ' off'}`} />{tracking ? 'Tracking' : 'Paused'}</span>
      )}
    </div>
  );
}
