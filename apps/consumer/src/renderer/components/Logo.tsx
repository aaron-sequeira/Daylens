import { useEffect, useId, useState } from 'react';
import { LOGO, LOGO_COLORS } from './logoPaths';
import { logoStartState, markAppOpenPlayed, type LogoAnimate } from '../lib/logo';

/** The Daylens Sunrise mark. `animate` draws it in (horizon → sun rises and traces itself → rays), starting the first
 * time the document is visible, so a window started hidden at login plays it when the user first opens it. */
export function Logo({ variant, size, animate = 'none', decorative = false }: { variant: 'full' | 'small'; size: number; animate?: LogoAnimate; decorative?: boolean }) {
  const m = LOGO[variant];
  const clipId = `dl-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [state, setState] = useState<'final' | 'pre' | 'play'>(() => logoStartState(animate));
  useEffect(() => {
    if (state !== 'pre') return;
    const start = (): void => { if (animate === 'app-open') markAppOpenPlayed(); setState('play'); };
    if (document.visibilityState === 'visible') { start(); return; }
    const onVis = (): void => { if (document.visibilityState === 'visible') start(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [state, animate]);
  const stroke = (color: string, w: number) => ({ fill: 'none', stroke: color, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, pathLength: 1 });
  return (
    <svg className={`dl-logo dl-${state}`} viewBox="0 0 100 100" width={size} height={size}
      role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Daylens'} aria-hidden={decorative || undefined}>
      <rect x="2" y="2" width="96" height="96" rx="24" fill={LOGO_COLORS.tile} />
      <g transform="translate(50 50) scale(0.86) translate(-50 -50)">
        <clipPath id={clipId}><rect x="0" y="0" width="100" height={m.clipY} /></clipPath>
        <g clipPath={`url(#${clipId})`}>
          <g className="dl-sun"><path className="dl-c" d={m.circle} {...stroke(LOGO_COLORS.sun, m.width[0])} /></g>
          <path className="dl-r" d={m.rays} {...stroke(LOGO_COLORS.sun, m.width[1])} />
        </g>
        <path className="dl-h" d={m.horizon} {...stroke(LOGO_COLORS.horizon, m.width[2])} />
      </g>
    </svg>
  );
}
