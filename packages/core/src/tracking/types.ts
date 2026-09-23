import type { ForegroundInfo, InputCounts } from '../types';

export interface ForegroundSource { get(): Promise<ForegroundInfo | null>; }
export interface InputSource { start(): void; stop(): void; drain(): InputCounts; }
export interface Clock { now(): number; }
export const systemClock: Clock = { now: () => Date.now() };
