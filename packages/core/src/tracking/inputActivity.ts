import { uIOhook } from 'uiohook-napi';
import type { InputCounts } from '../types';
import type { InputSource } from './types';

const blank = (): InputCounts => ({ mouseMoves: 0, mouseDistancePx: 0, clicks: 0, scrolls: 0, keyEvents: 0 });

export class UiohookInputSource implements InputSource {
  private counts = blank();
  private last: { x: number; y: number } | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    uIOhook.on('mousemove', (e) => {
      this.counts.mouseMoves++;
      if (this.last) this.counts.mouseDistancePx += Math.round(Math.hypot(e.x - this.last.x, e.y - this.last.y));
      this.last = { x: e.x, y: e.y };
    });
    uIOhook.on('click', () => { this.counts.clicks++; });
    uIOhook.on('wheel', () => { this.counts.scrolls++; });
    uIOhook.on('keydown', () => { this.counts.keyEvents++; }); // count only — no key identity stored
    uIOhook.start();
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    uIOhook.stop();
    uIOhook.removeAllListeners();
    this.running = false;
    this.last = null;
  }

  drain(): InputCounts {
    const c = this.counts;
    this.counts = blank();
    return c;
  }
}
