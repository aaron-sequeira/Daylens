import { useMemo } from 'react';
import type { OrbitCard } from '../lib/onboardingContent';

// Per-step background, orb hue shift and face (mockup onboarding-v2.html).
const LOOK = [
  { bg: 'var(--mint)', hue: '0deg', face: '☀️' },
  { bg: 'var(--lav)', hue: '40deg', face: '👋' },
  { bg: 'var(--peach)', hue: '-30deg', face: '🎯' },
  { bg: 'var(--sky)', hue: '80deg', face: '🗓️' },
  { bg: 'var(--pink)', hue: '-60deg', face: '🧲' },
  { bg: 'var(--sky)', hue: '120deg', face: '👀' },
  { bg: 'linear-gradient(135deg, #BFEBD3, #D8D2FC 50%, #F9DDB9)', hue: '0deg', face: '✨' }
];
const CONFETTI = ['#C9BEFF', '#9FE3C0', '#FFD19A', '#FFB4BA', '#A9D3FA', '#171717'];

export function OnboardingArt({ step, cards, bubble, celebrate }: { step: number; cards: OrbitCard[]; bubble: string; celebrate: boolean }) {
  const look = LOOK[Math.min(Math.max(step, 0), LOOK.length - 1)];
  const sparks = useMemo(() => Array.from({ length: 16 }, () => ({
    left: 10 + Math.random() * 80, top: 40 + Math.random() * 55, t: 4 + Math.random() * 5, d: Math.random() * 6
  })), []);
  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 2 + Math.random() * 1.6, color: CONFETTI[i % CONFETTI.length]
  })), []);
  const n = cards.length;

  return (
    <div className="ob-art" style={{ ['--bg' as string]: look.bg }}>
      <div className="ob-deco" aria-hidden="true">
        <div className="ob-blob b1" /><div className="ob-blob b2" /><div className="ob-blob b3" /><div className="ob-blob b4" />
        <div className="ob-ring r1" /><div className="ob-ring r2" />
        <div className="ob-orbwrap" style={{ ['--hue' as string]: look.hue }}>
          <div className="ob-glow" /><div className="ob-orb" />
          <div className="ob-face"><span key={look.face}>{look.face}</span></div>
        </div>
        <div className="ob-center">
          {cards.map((card, k) => {
            const r = n > 6 && k % 2 ? 250 : 185; // two orbits when crowded
            return (
              <div key={`${step}-${k}-${card.title}`} className="ob-orbit"
                style={{ ['--a' as string]: `${(k * 360) / n - 90}deg`, ['--r' as string]: `${r}px`, ['--d' as string]: `${r > 200 ? 110 : 80}s` }}>
                <div className={`ob-fcard${k % 3 === 0 ? ' tint' : ''}`}
                  style={{ ['--c' as string]: card.color, ['--in' as string]: `${0.15 + k * 0.07}s`, ['--fl' as string]: `${-k * 0.6}s` }}>
                  <i>{card.icon}</i><div><b>{card.title}</b><small>{card.sub}</small></div>
                </div>
              </div>
            );
          })}
        </div>
        {sparks.map((s, i) => (
          <span key={i} className="ob-spark" style={{ left: `${s.left}%`, top: `${s.top}%`, ['--t' as string]: `${s.t}s`, ['--dl' as string]: `${s.d}s` }} />
        ))}
        {celebrate && confetti.map((cf, i) => (
          <span key={i} className="ob-confetti" style={{ left: `${cf.left}%`, background: cf.color, animationDelay: `${cf.delay}s`, animationDuration: `${cf.dur}s` }} />
        ))}
      </div>
      <p className="ob-bubble" aria-live="polite"><span key={bubble}>{bubble}</span></p>
    </div>
  );
}
