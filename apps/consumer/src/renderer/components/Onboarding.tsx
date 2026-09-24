import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { DaylensSettings } from '../../main/settings';
import { GOALS, MAX_DISTRACTIONS, MAX_TEXT, ROLES, type Profile } from '../../shared/profileOptions';
import { api } from '../lib/api';
import { bubbleFor, cardsFor, DISTRACTION_CHOICES, GOAL_INFO, ROLE_INFO, STEP_COUNT, summaryFor } from '../lib/onboardingContent';
import { OnboardingArt } from './OnboardingArt';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Onboarding({ mode, initial, onDone, onCancel }: {
  mode: 'first' | 'redo'; initial: Profile; onDone: (s: DaylensSettings) => void; onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Profile>(initial);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const stepRef = useRef<HTMLElement>(null);
  const cancelled = useRef(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = STEP_COUNT - 1;
  const isQuestion = step >= 1 && step < last;
  const shown = { ...a, name: a.name.trim() };

  const go = (n: number): void => { setError(null); setStep(Math.max(0, Math.min(last, n))); };

  useEffect(() => { // move focus into the new step (first input, else its heading)
    const el = stepRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('input') ?? el.querySelector<HTMLElement>('h1');
    const t = setTimeout(() => target?.focus(), 350);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => { // reset on (re)mount so StrictMode's dev-only mount→cleanup→mount doesn't wedge finish()
    cancelled.current = false;
    return () => { // unmount (e.g. Cancel): stop the in-flight save from finishing onto a dead screen
      cancelled.current = true;
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, []);

  const addOther = (): void => {
    const v = other.trim().replace(/\s+/g, ' ');
    setOther('');
    if (!v || a.distractions.length >= MAX_DISTRACTIONS || a.distractions.some((d) => d.toLowerCase() === v.toLowerCase())) return;
    setA({ ...a, distractions: [...a.distractions, v] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229 || step === last || t instanceof HTMLButtonElement || t.id === 'ob-other') return;
    e.preventDefault();
    go(step + 1);
  };

  const finish = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      let s = await api.profile.save(a);
      if (cancelled.current) return;
      if (mode === 'first') s = await api.consent.grant(); // consent only when onboarding is finished
      if (cancelled.current) return;
      setCelebrate(true);
      doneTimer.current = setTimeout(() => onDone(s), 1600);
    } catch (e) {
      if (cancelled.current) return;
      console.error('[renderer] onboarding save failed:', e);
      setError("Couldn't save that. Check your answers and try again.");
      setSaving(false);
    }
  };

  const nav = (next: string, onNext: () => void = () => go(step + 1)) => (
    <div className="ob-nav">
      {step > 0 && <button className="btn s" onClick={() => go(step - 1)} disabled={saving}>Back</button>}
      <button className="btn" onClick={onNext} disabled={saving}>{next}</button>
    </div>
  );

  const body = (): JSX.Element => {
    switch (step) {
      case 0:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--mint)' }}>☀</i>Welcome</p>
          <h1 tabIndex={-1}>See your day<br /><b>clearly.</b></h1>
          <p className="lead">Daylens quietly notices how you use your PC and nudges you toward healthier habits. First, a few quick questions so it can get to know you.</p>
          <div className="promise">
            <div><i style={{ background: 'var(--mint)' }}>🔒</i><span><b>Everything stays on this PC.</b> No account, no cloud, no uploads.</span></div>
            <div><i style={{ background: 'var(--lav)' }}>🪟</i><span>Records <b>which app and window</b> is in front, and for how long.</span></div>
            <div><i style={{ background: 'var(--pink)' }}>⌨️</i><span>Counts activity, <b>never what you type</b>.</span></div>
            <div><i style={{ background: 'var(--peach)' }}>🚀</i><span>Starts with Windows. Pause or turn it off any time in Settings.</span></div>
          </div>
          {nav(mode === 'redo' ? "Let's update your answers →" : "Let's get started →")}
        </>);
      case 1:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--lav)' }}>👋</i>About you</p>
          <h1 tabIndex={-1}>{shown.name ? <>Nice to meet you,<br /><b>{shown.name}</b> <span className="ob-wave">👋</span></> : <>What should I<br /><b>call you?</b></>}</h1>
          <div className="ob-field"><input aria-label="Your name" placeholder="Your first name" maxLength={MAX_TEXT} autoComplete="off" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
          <p className="ob-label">What do you mostly use this PC for? <span>Pick any</span></p>
          <div className="ob-chips">
            {ROLES.map((r) => (
              <button key={r} className="ob-chip" style={{ ['--c' as string]: ROLE_INFO[r].color }} aria-pressed={a.roles.includes(r)} onClick={() => setA({ ...a, roles: toggle(a.roles, r) })}>
                <span className="e">{ROLE_INFO[r].emoji}</span>{ROLE_INFO[r].label}
              </button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> the same app means different things for different people. YouTube is <i>learning</i> for a student and <i>a break</i> for a developer.</span></p>
          {nav('Continue →')}
        </>);
      case 2:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--peach)' }}>🎯</i>Your goals</p>
          <h1 tabIndex={-1}>What should I<br /><b>help you with?</b></h1>
          <div className="ob-goals">
            {GOALS.map((g) => (
              <button key={g} className="ob-goal" style={{ ['--c' as string]: GOAL_INFO[g].color }} aria-pressed={a.goals.includes(g)} onClick={() => setA({ ...a, goals: toggle(a.goals, g) })}>
                <span className="e">{GOAL_INFO[g].emoji}</span><b>{GOAL_INFO[g].title}</b><small>{GOAL_INFO[g].sub}</small>
              </button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> I'll nudge you most about what matters to you, and stay quiet about the rest.</span></p>
          {nav('Continue →')}
        </>);
      case 3:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--sky)' }}>🗓</i>Your rhythm</p>
          <h1 tabIndex={-1}>When are you<br /><b>at your desk?</b></h1>
          <div className="ob-arc" aria-hidden="true">
            <svg viewBox="0 0 520 74" preserveAspectRatio="none">
              <path d="M10 70 Q260 -40 510 70" fill="none" stroke="rgba(23,23,23,.15)" strokeWidth="2" strokeDasharray="5 6" />
              <g className="ob-sun" style={{ offsetPath: "path('M10 70 Q260 -40 510 70')" }}><circle r="17" fill="rgba(255,209,154,.35)" /><circle r="11" fill="#FFD19A" /></g>
            </svg>
          </div>
          <div className="ob-sched">
            <div className="ob-tcard" style={{ background: 'var(--peach)' }}><span className="e">☀️</span><label htmlFor="ob-start">I usually start at</label>
              <input id="ob-start" type="time" value={a.start} onChange={(e) => { if (e.target.value) setA({ ...a, start: e.target.value }); }} /></div>
            <div className="ob-tcard" style={{ background: 'var(--lav)' }}><span className="e">🌙</span><label htmlFor="ob-bed">I'd like to log off by</label>
              <input id="ob-bed" type="time" value={a.bed} onChange={(e) => { if (e.target.value) setA({ ...a, bed: e.target.value }); }} /></div>
          </div>
          <p className="ob-label">Days I'm usually on</p>
          <div className="ob-days">
            {DAYS.map((d, i) => (
              <button key={d} className="ob-day" aria-label={d} aria-pressed={a.days.includes(i + 1)} onClick={() => setA({ ...a, days: toggle(a.days, i + 1).sort((x, y) => x - y) })}>{d[0]}</button>
            ))}
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> sets your wind-down reminder and tells me when focus matters most.</span></p>
          {nav('Continue →')}
        </>);
      case 4:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--pink)' }}>🧲</i>Honest moment</p>
          <h1 tabIndex={-1}>What pulls you<br /><b>away the most?</b></h1>
          <p className="lead" style={{ marginBottom: 14 }}>No judgement. I'll just keep a gentle eye on these for you.</p>
          <div className="ob-chips">
            {DISTRACTION_CHOICES.map((d) => (
              <button key={d.label} className="ob-chip" style={{ ['--c' as string]: 'var(--pink)' }} aria-pressed={a.distractions.includes(d.label)}
                disabled={!a.distractions.includes(d.label) && a.distractions.length >= MAX_DISTRACTIONS}
                onClick={() => setA({ ...a, distractions: toggle(a.distractions, d.label) })}>
                <span className="e">{d.emoji}</span>{d.label}
              </button>
            ))}
            {a.distractions.filter((d) => !DISTRACTION_CHOICES.some((c) => c.label === d)).map((d) => (
              <button key={d} className="ob-chip" style={{ ['--c' as string]: 'var(--pink)' }} aria-pressed onClick={() => setA({ ...a, distractions: a.distractions.filter((x) => x !== d) })}>
                <span className="e">✳️</span>{d}
              </button>
            ))}
          </div>
          <div className="ob-field small" style={{ maxWidth: 360 }}>
            <input id="ob-other" aria-label="Add another distraction" placeholder="Something else? Type and press Enter" maxLength={MAX_TEXT}
              disabled={a.distractions.length >= MAX_DISTRACTIONS} value={other} onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); addOther(); } }} />
          </div>
          <p className="ob-why">💡 <span><b>Why I ask:</b> I'll flag long scrolls on these and can set soft limits later.</span></p>
          {nav('Continue →')}
        </>);
      default:
        return (<>
          <p className="ob-kicker"><i style={{ background: 'var(--mint)' }}>✨</i>All set</p>
          <h1 tabIndex={-1}>You're all set,<br /><b>{shown.name || 'friend'}.</b></h1>
          <p className="lead" style={{ marginBottom: 14 }}>Here's what I learned about you. You can change any of this in Settings.</p>
          <div className="ob-summary">
            {summaryFor(a).map((r) => (
              <div key={r.icon} className="ob-sum"><i style={{ background: r.color }}>{r.icon}</i><span>{r.text}{r.strong && <> <b>{r.strong}</b></>}</span></div>
            ))}
          </div>
          {error && <p className="ob-error" role="alert">{error}</p>}
          {nav(mode === 'redo' ? 'Save my answers ✨' : 'Start my day ✨', () => { void finish(); })}
        </>);
    }
  };

  return (
    <div className="ob" onKeyDown={onKeyDown}>
      <div className="ob-left">
        <div className="ob-progress">
          <div className="ob-track"><div style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }} /></div>
          <span className="ob-stepno">{step + 1} of {STEP_COUNT}</span>
          {isQuestion && <button className="ob-link" onClick={() => go(step + 1)}>Skip this question</button>}
          {mode === 'redo' && onCancel && <button className="ob-link" onClick={onCancel} disabled={saving}>Cancel</button>}
        </div>
        <section className="ob-step" key={step} ref={stepRef}>{body()}</section>
      </div>
      <OnboardingArt step={step} cards={cardsFor(step, shown)} bubble={bubbleFor(step, shown)} celebrate={celebrate} />
    </div>
  );
}
