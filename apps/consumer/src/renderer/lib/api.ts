import type { DaylensApi } from '../../preload';

declare global { interface Window { daylens: DaylensApi } }
export const api: DaylensApi = window.daylens;
