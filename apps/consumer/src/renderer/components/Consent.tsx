export function Consent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="consent">
      <div className="consent-l">
        <h1>See your day<br /><b>clearly.</b></h1>
        <p className="lead">Daylens quietly keeps track of how you spend time on your PC, so you can see where the day went and build healthier screen habits.</p>
        <div className="promise">
          <div><i style={{ background: 'var(--mint)' }}>🔒</i><span><b>Everything stays on this PC.</b> No account, no cloud, no uploads.</span></div>
          <div><i style={{ background: 'var(--lav)' }}>🪟</i><span>Records <b>which app and window</b> is in front, and for how long.</span></div>
          <div><i style={{ background: 'var(--pink)' }}>⌨️</i><span>Counts mouse and keyboard <b>activity</b> to tell active from idle. It <b>never records what you type</b>.</span></div>
          <div><i style={{ background: 'var(--peach)' }}>⏸</i><span>Pause any time from the tray icon.</span></div>
          <div><i style={{ background: 'var(--mint)' }}>🚀</i><span><b>Starts with Windows</b> so your day is complete. You can turn this off in Settings.</span></div>
        </div>
        <button className="btn" onClick={onAccept}>Start tracking →</button>
      </div>
      <div className="consent-r">
        <div className="orb" />
        <div className="float" style={{ top: '18%', left: '10%' }}><span style={{ color: 'var(--muted)' }}>Today</span><b>6h 12m</b></div>
        <div className="float" style={{ top: '26%', right: '9%', animationDelay: '-1.5s', background: 'var(--lav)' }}>✦ 90-min focus streak</div>
        <div className="float" style={{ bottom: '20%', left: '14%', animationDelay: '-3s', background: 'var(--peach)' }}>☀ Your week at a glance</div>
        <div className="float" style={{ bottom: '14%', right: '12%', animationDelay: '-2s' }}>Health score <b>72</b></div>
      </div>
    </div>
  );
}
