export type LogoAnimate = 'none' | 'app-open' | 'mount';

// ponytail: module flag = once per window lifetime (a renderer reload resets it, which is a re-open anyway).
let appOpenPlayed = false;

/** 'final' = draw the finished logo now; 'pre' = hold the undrawn frame until the window is visible, then play. */
export function logoStartState(animate: LogoAnimate): 'final' | 'pre' {
  if (animate === 'none') return 'final';
  if (animate === 'app-open' && appOpenPlayed) return 'final';
  return 'pre';
}
export function markAppOpenPlayed(): void { appOpenPlayed = true; }
export function resetLogoForTest(): void { appOpenPlayed = false; }
