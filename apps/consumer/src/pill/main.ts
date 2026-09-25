import './pill.css';
import type { PillApi } from '../preload/pill';
import type { PillNudge } from '../main/coach/types';
import { NUDGE_LOOK } from '../shared/nudgeLook';
import {
  MAX_CARDS, OPEN_AFTER_MS, AUTO_HIDE_MS,
  PILL_COLLAPSED_H, PILL_OPEN_H, PILL_OPEN_FEWER_H,
  overflow, computeLayout, tickDown, canFan
} from './stack';

declare global { interface Window { pill?: PillApi } }

type Action = 'primary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';

interface Card {
  n: PillNudge;
  el: HTMLElement;
  done: boolean;
  openReady: boolean;
  remainingMs: number;
  hideStartedAt: number | null;
  hideTimer?: ReturnType<typeof setTimeout>;
  openTimer?: ReturnType<typeof setTimeout>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Runs only when the preload actually exposed window.pill — a missing/failed preload
 * (or the page loaded outside Electron) must do nothing, not throw. */
function init(pillApi: PillApi): void {
  const stack = document.getElementById('stack')!;
  let cards: Card[] = [];
  const hoveredIds = new Set<number>();

  function armAutoHide(c: Card): void {
    c.hideStartedAt = Date.now();
    c.hideTimer = setTimeout(() => finish(c, 'expired'), c.remainingMs);
  }
  function pauseAutoHide(c: Card): void {
    if (c.hideTimer === undefined || c.hideStartedAt === null) return;
    clearTimeout(c.hideTimer);
    c.hideTimer = undefined;
    c.remainingMs = tickDown(c.remainingMs, Date.now() - c.hideStartedAt);
    c.hideStartedAt = null;
  }
  function resumeAutoHide(c: Card): void {
    if (c.hideTimer !== undefined) return;
    if (c.remainingMs <= 0) { finish(c, 'expired'); return; }
    armAutoHide(c);
  }

  function frontHeight(front: Card | undefined): number {
    if (!front || !front.el.classList.contains('open')) return PILL_COLLAPSED_H;
    return front.n.offerFewer ? PILL_OPEN_FEWER_H : PILL_OPEN_H;
  }

  function relayout(): void {
    const layout = computeLayout(cards.map((c) => ({ id: c.n.id, done: c.done, openReady: c.openReady })));
    const byId = new Map(layout.map((r) => [r.id, r]));
    cards.forEach((c) => {
      const r = byId.get(c.n.id);
      if (!r) return; // fading (done) card: leave its classes alone
      c.el.classList.toggle('behind', r.depth > 0);
      c.el.classList.toggle('b2', r.depth > 1);
      c.el.classList.toggle('open', r.open);
    });
    const live = cards.filter((c) => !c.done);
    const front = live[live.length - 1];
    stack.classList.toggle('fan', canFan(frontHeight(front), Math.max(0, live.length - 1)));
  }

  function updateHoverState(): void {
    const any = hoveredIds.size > 0;
    stack.classList.toggle('hovering', any);
    pillApi.hover(any);
    cards.forEach((c) => {
      if (c.done || !c.openReady) return;
      if (any) pauseAutoHide(c); else resumeAutoHide(c);
    });
  }

  stack.addEventListener('mouseover', (e) => {
    const from = (e.relatedTarget as Element | null)?.closest('.pill') ?? null;
    const to = (e.target as Element).closest('.pill');
    if (!to || to === from) return;
    const card = cards.find((c) => c.el === to);
    if (!card || card.done || hoveredIds.has(card.n.id)) return;
    hoveredIds.add(card.n.id);
    updateHoverState();
  });
  stack.addEventListener('mouseout', (e) => {
    const from = (e.target as Element).closest('.pill');
    const to = (e.relatedTarget as Element | null)?.closest('.pill') ?? null;
    if (!from || to === from) return;
    const card = cards.find((c) => c.el === from);
    if (!card || !hoveredIds.delete(card.n.id)) return;
    updateHoverState();
  });

  function finish(c: Card, action: Action): void {
    if (c.done) return;
    c.done = true;
    if (c.hideTimer !== undefined) clearTimeout(c.hideTimer);
    if (c.openTimer !== undefined) clearTimeout(c.openTimer);
    pillApi.action(c.n.id, action);
    c.el.classList.remove('open');
    setTimeout(() => c.el.classList.add('hide'), 350);
    setTimeout(() => {
      c.el.remove();
      cards = cards.filter((x) => x !== c);
      if (hoveredIds.delete(c.n.id)) updateHoverState();
      relayout();
      if (!cards.length) pillApi.empty();
    }, 900);
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
    const card: Card = { n, el: root, done: false, openReady: false, remainingMs: AUTO_HIDE_MS, hideStartedAt: null };
    if (n.offerFewer) { const f = el('button', 'fewer-link', 'Show fewer like this?'); full.append(f); root.classList.add('fewer'); f.onclick = () => finish(card, 'fewer'); }
    const bar = el('div', 'bar'); bar.append(el('i'));
    root.append(head, full, bar);
    primary.onclick = () => finish(card, 'primary');
    snooze.onclick = () => finish(card, 'snooze');
    x.onclick = () => finish(card, 'dismiss');
    stack.append(root);
    cards.push(card);

    // Expire only LIVE overflow, oldest first — a card mid dismiss-out doesn't count,
    // so this always terminates (unlike expiring cards[0] until length <= MAX, which
    // never shrinks the array until each expired card's own removal timer fires).
    const toExpire = overflow(cards.map((c) => ({ id: c.n.id, done: c.done })), MAX_CARDS);
    for (const entry of toExpire) {
      const victim = cards.find((c) => c.n.id === entry.id);
      if (victim) finish(victim, 'expired');
    }

    relayout();
    requestAnimationFrame(() => root.classList.remove('hide'));
    card.openTimer = setTimeout(() => {
      if (card.done) return;
      card.openReady = true;
      armAutoHide(card);
      relayout();
    }, OPEN_AFTER_MS);
  }

  pillApi.onShow(show);
  pillApi.onDismissAll(() => [...cards].forEach((c) => finish(c, 'dismiss')));
}

if (window.pill) init(window.pill);
