import { Logo } from './Logo';

export function TitleBar({ tracking }: { tracking: boolean | null }) {
  return (
    <div className="titlebar">
      <Logo variant="small" size={16} decorative />
      Daylens
      {tracking !== null && (
        <span className="status"><i className={`dot${tracking ? '' : ' off'}`} />{tracking ? 'Tracking' : 'Paused'}</span>
      )}
    </div>
  );
}
