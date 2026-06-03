import type { WorkSightApi } from '../../preload';

declare global { interface Window { worksight: WorkSightApi } }
export const api: WorkSightApi = window.worksight;
