import { LAYA_PEAK_BYTES } from '../models/manifest';

export const GB = 1024 ** 3;
/** Free memory a batch needs before it may start: the model's peak plus a 1 GB safety margin. */
export const LAYA_NEED_BYTES = LAYA_PEAK_BYTES + GB;
const IDLE_SEC = 180;
const SPARE_BYTES = 2 * GB;

/** Label only when it can't hurt: enough memory, and the user is away or there is plenty to spare. */
export function batchAllowed(i: { freeBytes: number; idleSec: number; locked: boolean; needBytes: number }): boolean {
  if (i.freeBytes < i.needBytes) return false;
  return i.idleSec >= IDLE_SEC || i.locked || i.freeBytes >= i.needBytes + SPARE_BYTES;
}
