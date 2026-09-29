import './pill.css';
import type { PillApi } from '../preload/pill';
import type { PillNudge } from '../main/coach/types';
import { NUDGE_LOOK } from '../shared/nudgeLook';
import {
  MAX_CARDS, OPEN_AFTER_MS, AUTO_HIDE_MS,
  PILL_COLLAPSED_H, PILL_OPEN_H, PILL_OPEN_FEWER_H,
  overflow, computeLayout, canFan,
  arm, pause as pauseState, resume as resumeState, type AutoHideState
} from './stack';

declare global { interface Window { pill?: PillApi } }

type Action = 'primary' | 'secondary' | 'dismiss' | 'snooze' | 'fewer' | 'expired';

interface Card {
  n: PillNudge;
  el: HTMLElement;
  done: boolean;
  openReady: boolean;
  autoHide: AutoHideState;
  hideStartedAt: number | null; // wall-clock time the current run began, only while autoHide.running
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

  /** Paints the progress bar from the card's actual remaining time (not a fixed
   * duration) so a paused-then-resumed, or hover-armed, card's bar always starts
   * from where its real countdown is — never a reset-to-full flash. The animation
   * is force-restarted (name -> none -> reflow -> name) so changing --dur mid-flight
   * takes effect instead of being ignored by an already-running animation. */
  function paintBar(c: Card): void {
    const bar = c.el.querySelector('.bar > i') as HTMLElement | null;
    if (!bar) return;
    const left = Math.max(0, Math.min(1, c.autoHide.remainingMs / AUTO_HIDE_MS));
    bar.style.setProperty('--left', String(left));
    bar.style.setProperty('--dur', `${c.autoHide.remainingMs}ms`);
    bar.style.animationName = 'none';
    void bar.offsetWidth; // force reflow so the next line actually restarts the animation
    bar.style.animationName = 'shrink';
  }

  function scheduleHideTimer(c: Card): void {
    c.hideStartedAt = Date.now();
    c.hideTimer = setTimeout(() => finish(c, 'expired'), c.autoHide.remainingMs);
  }
  /** Arms the countdown for a card that just opened. If the stack is already being
   * hovered, it starts paused at the full time instead of ticking down under the
   * cursor (arm()'s `hovering` flag models this, see stack.test.ts). */
  function armAutoHide(c: Card): void {
    c.autoHide = arm(AUTO_HIDE_MS, hoveredIds.size > 0);
    if (c.autoHide.running) scheduleHideTimer(c);
    paintBar(c);
  }
  function pauseAutoHide(c: Card): void {
    if (!c.autoHide.running) return;
    const elapsed = c.hideStartedAt === null ? 0 : Date.now() - c.hideStartedAt;
    if (c.hideTimer !== undefined) clearTimeout(c.hideTimer);
    c.hideTimer = undefined;
    c.hideStartedAt = null;
    c.autoHide = pauseState(c.autoHide, elapsed);
  }
  function resumeAutoHide(c: Card): void {
    if (c.autoHide.running) return;
    if (c.autoHide.remainingMs <= 0) { finish(c, 'expired'); return; }
    c.autoHide = resumeState(c.autoHide);
    scheduleHideTimer(c);
    paintBar(c);
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
      const wasOpen = c.el.classList.contains('open');
      c.el.classList.toggle('behind', r.depth > 0);
      c.el.classList.toggle('b2', r.depth > 1);
      c.el.classList.toggle('open', r.open);
      if (r.open && !wasOpen && c.openReady) {
        // Newly open (promoted to front, or just opened): repaint the bar from the
        // CURRENT remaining time, not the stale --left/--dur from its last arm/pause.
        // If it's running, pause+resume to fold the elapsed time in first — otherwise
        // its already-frozen remainingMs is current as-is.
        if (c.autoHide.running) { pauseAutoHide(c); resumeAutoHide(c); }
        else paintBar(c);
      }
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
    const secondary = n.secondaryLabel ? el('span', undefined, n.secondaryLabel) : null;
    acts.append(...(secondary ? [primary, secondary, snooze] : [primary, snooze]));
    full.append(el('b', undefined, n.title), el('p', undefined, n.body), acts);
    const card: Card = { n, el: root, done: false, openReady: false, autoHide: { remainingMs: AUTO_HIDE_MS, running: false }, hideStartedAt: null };
    if (n.offerFewer) { const f = el('button', 'fewer-link', 'Show fewer like this?'); full.append(f); root.classList.add('fewer'); f.onclick = () => finish(card, 'fewer'); }
    const bar = el('div', 'bar'); bar.append(el('i'));
    root.append(head, full, bar);
    primary.onclick = () => finish(card, 'primary');
    if (secondary) secondary.onclick = () => finish(card, 'secondary');
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
  // Bulk dismiss (Ctrl+Alt+D, "Delete my activity") is not a per-nudge dismissal: report 'expired' so it
  // never counts toward the dismissal back-off.
  pillApi.onDismissAll(() => [...cards].forEach((c) => finish(c, 'expired')));
}

if (window.pill) init(window.pill);
