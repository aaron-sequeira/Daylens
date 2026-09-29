import './break.css';
import type { BreakApi } from '../preload/break';
import { SCENES } from '../shared/scenes';

declare global { interface Window { brk: BreakApi } }

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const ring = $('ring') as unknown as SVGCircleElement;
const skip = $('skip') as HTMLButtonElement, more = $('more') as HTMLButtonElement;
let total = 0, left = 0, elapsed = 0, breathe = false, timer: ReturnType<typeof setInterval> | undefined, ended = false;
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;

const end = (completed: boolean): void => {
  if (ended) return;
  ended = true;
  clearInterval(timer);
  window.brk.done({ completed, seconds: Math.min(elapsed, 3600) });
};

function tick(): void {
  left--; elapsed++;
  $('num').textContent = fmt(Math.max(0, left));
  ring.style.strokeDashoffset = String(691 * (1 - left / total));
  if (breathe) $('hint').textContent = Math.floor(elapsed / 4) % 2 ? 'Breathe out…' : 'Breathe in…';
  if (left <= 0) {
    clearInterval(timer);
    $('hint').textContent = 'Nice. Welcome back 🌿';
    more.disabled = true;
    setTimeout(() => end(true), 1400);
  }
}

window.brk.onStart(({ animation, seconds, title, text, long, doneLabel }) => {
  total = left = seconds;
  breathe = animation === 'breathe' || animation === 'eyes';
  const scene = $('scene');
  scene.innerHTML = SCENES[animation]; // static markup from shared/scenes.ts, never user input
  scene.style.setProperty('--sc-dur', `${Math.min(seconds, 60)}s`);
  $('title').textContent = title; // reminder names/messages are user text: textContent only
  $('text').textContent = text;
  $('num').textContent = fmt(left);
  if (long) { skip.textContent = "I'm back"; more.hidden = true; skip.onclick = () => end(elapsed >= total / 2); }
  else if (doneLabel) { skip.textContent = doneLabel; skip.onclick = () => end(true); }
  else skip.onclick = () => end(false);
  timer = setInterval(tick, 1000);
});
window.brk.onExtend(() => { left += 60; total += 60; });
more.onclick = () => window.brk.extend();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });
