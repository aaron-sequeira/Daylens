import './break.css';
import type { BreakApi } from '../preload/break';

declare global { interface Window { brk: BreakApi } }

const COPY = {
  eye: ['Look at something far away', 'At least 6 metres, like a window, a wall across the room, or the sky.'],
  stretch: ['Stand up and stretch', 'Roll your shoulders, reach up, and take a few slow breaths.']
} as const;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const ring = $('ring') as unknown as SVGCircleElement;
let total = 0, left = 0, elapsed = 0, timer: ReturnType<typeof setInterval> | undefined, ended = false;

const end = (completed: boolean): void => {
  if (ended) return;
  ended = true;
  clearInterval(timer);
  window.brk.done({ completed, seconds: elapsed });
};

function tick(): void {
  left--; elapsed++;
  $('num').textContent = String(left);
  ring.style.strokeDashoffset = String(540 * (1 - left / total));
  $('hint').textContent = Math.floor(elapsed / 4) % 2 ? 'Breathe out…' : 'Breathe in…';
  if (left <= 0) { clearInterval(timer); $('hint').textContent = 'Nice. Welcome back 🌿'; setTimeout(() => end(true), 1400); }
}

window.brk.onStart(({ kind, seconds }) => {
  total = left = seconds;
  $('title').textContent = COPY[kind][0];
  $('text').textContent = COPY[kind][1];
  $('num').textContent = String(left);
  timer = setInterval(tick, 1000);
});
window.brk.onExtend(() => { left += 60; total += 60; });
$('skip').onclick = () => end(false);
$('more').onclick = () => window.brk.extend();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });
