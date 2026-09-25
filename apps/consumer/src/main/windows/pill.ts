import { z } from 'zod';
import type { PillAction, PillNudge } from '../coach/types';

export interface PillWindowLike {
  send(channel: string, payload?: unknown): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  showInactive(): void;
  setPosition(x: number, y: number): void;
  destroy(): void;
  isDestroyed(): boolean;
  onReady(cb: () => void): void;
}

export const pillMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hover'), hover: z.boolean() }).strict(),
  z.object({ type: z.literal('action'), id: z.number().int(), action: z.enum(['primary', 'dismiss', 'snooze', 'fewer', 'expired']) }).strict(),
  z.object({ type: z.literal('empty') }).strict()
]);
export type PillMessage = z.infer<typeof pillMessage>;

export function createPillManager(deps: { makeWindow(): PillWindowLike; placement(): { x: number; y: number }; onAction(id: number, action: PillAction): void }) {
  let win: PillWindowLike | null = null;
  let ready = false;
  let queue: PillNudge[] = [];
  // Ids sent to the renderer ('pill:show') that haven't yet come back as a terminal
  // 'action' message. Guards against the race where the renderer's 'empty' (sent when
  // its own card list drains to zero) crosses in flight with a fresh 'pill:show' this
  // manager just sent — destroying the window then would drop that in-flight nudge.
  const outstanding = new Set<number>();

  const flush = (): void => {
    if (!win || !ready) return;
    for (const n of queue) {
      win.send('pill:show', n);
      outstanding.add(n.id);
    }
    queue = [];
    win.showInactive();
  };

  return {
    show(n: PillNudge): boolean {
      try {
        if (!win || win.isDestroyed()) {
          ready = false;
          win = deps.makeWindow();
          // Placed once, right when the window is created — not on every flush.
          const p = deps.placement();
          win.setPosition(p.x, p.y);
          win.setIgnoreMouseEvents(true);
          win.onReady(() => { ready = true; flush(); });
        }
        queue.push(n);
        flush();
        return true;
      } catch (e) {
        console.error('[pill] window failed:', e);
        win = null;
        return false;
      }
    },
    dismissAll(): void {
      // Nudges still queued (window not ready yet) never reached the renderer, so it
      // can't report them dismissed — report them ourselves and drop them here.
      if (queue.length) {
        const dropped = queue;
        queue = [];
        for (const n of dropped) deps.onAction(n.id, 'dismiss');
      }
      if (win && !win.isDestroyed()) win.send('pill:dismissAll');
    },
    handle(msg: PillMessage): void {
      if (msg.type === 'hover') {
        win?.setIgnoreMouseEvents(!msg.hover);
      } else if (msg.type === 'action') {
        outstanding.delete(msg.id);
        deps.onAction(msg.id, msg.action);
      } else {
        if (outstanding.size > 0 || queue.length > 0) return; // stale 'empty': ignore
        win?.destroy();
        win = null;
        ready = false;
      }
    }
  };
}

export const PILL_W = 400, PILL_H = 260, PILL_MARGIN = 16;
