import './pill.css';
import type { PillApi } from '../preload/pill';
import type { PillNudge } from '../main/coach/types';
import { NUDGE_LOOK } from '../shared/nudgeLook';

declare global { interface Window { pill: PillApi } }

const MAX = 3, OPEN_AFTER = 700, AUTO_HIDE = 8000;
const stack = document.getElementById('stack')!;
let hovering = false;
stack.addEventListener('mouseenter', () => { hovering = true; window.pill.hover(true); });
stack.addEventListener('mouseleave', () => { hovering = false; window.pill.hover(false); });

interface Card { n: PillNudge; el: HTMLElement; done: boolean; timer?: ReturnType<typeof setTimeout>; }
let cards: Card[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function layout(): void {
  cards.forEach((c, i) => {
    const depth = cards.length - 1 - i;
    c.el.classList.toggle('behind', depth > 0);
    c.el.classList.toggle('b2', depth > 1);
  });
}

function finish(c: Card, action: 'primary' | 'dismiss' | 'snooze' | 'fewer' | 'expired'): void {
  if (c.done) return;
  c.done = true;
  clearTimeout(c.timer);
  window.pill.action(c.n.id, action);
  c.el.classList.remove('open');
  setTimeout(() => c.el.classList.add('hide'), 350);
  setTimeout(() => {
    c.el.remove();
    cards = cards.filter((x) => x !== c);
    layout();
    if (!cards.length) window.pill.empty();
  }, 900);
}

function autoHide(c: Card): void {
  c.timer = setTimeout(() => (hovering ? autoHide(c) : finish(c, 'expired')), AUTO_HIDE);
}

function show(n: PillNudge): void {
  const look = NUDGE_LOOK[n.kind];
  const root = el('div', 'pill hide');
  root.style.setProperty('--c', look.color);
  const head = el('div', 'head');
  const labels = el('span', 'labels');
  const mini = el('span', 'mini', n.mini); mini.append(el('em', undefined, `· ${n.stat}`));
  const kind = el('span', 'kind'); kind.append(el('span', undefined, look.label));
  const x = el('i', 'x', 'now · ✕'); kind.append(x);
  labels.append(mini, kind);
  head.append(el('span', 'ic', look.emoji), labels);
  const full = el('div', 'full');
  const acts = el('div', 'acts');
  const primary = el('span', undefined, n.primaryLabel);
  const snooze = el('span', undefined, 'Snooze 1 h');
  acts.append(primary, snooze);
  full.append(el('b', undefined, n.title), el('p', undefined, n.body), acts);
  if (n.offerFewer) { const f = el('button', 'fewer-link', 'Show fewer like this?'); full.append(f); root.classList.add('fewer'); f.onclick = () => finish(card, 'fewer'); }
  const bar = el('div', 'bar'); bar.append(el('i'));
  root.append(head, full, bar);
  const card: Card = { n, el: root, done: false };
  primary.onclick = () => finish(card, 'primary');
  snooze.onclick = () => finish(card, 'snooze');
  x.onclick = () => finish(card, 'dismiss');
  stack.append(root);
  cards.push(card);
  while (cards.length > MAX) finish(cards[0], 'expired');
  layout();
  requestAnimationFrame(() => root.classList.remove('hide'));
  setTimeout(() => { if (!card.done) root.classList.add('open'); }, OPEN_AFTER);
  autoHide(card);
}

window.pill.onShow(show);
window.pill.onDismissAll(() => [...cards].forEach((c) => finish(c, 'dismiss')));
