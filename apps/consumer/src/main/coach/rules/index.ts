import type { Rule } from '../snapshot';
import { eyeBreak, goal, stretch, windDown } from './health';
import { appCap, doomscroll, scattered, stuckEscape } from './behaviour';
import { repeatSearch, stuckTip } from './tips';
import { belowAvg, deepWork } from './wins';

/** Priority order: health first, wins last. */
export const RULES: Rule[] = [eyeBreak, stretch, windDown, goal, doomscroll, scattered, stuckEscape, appCap, stuckTip, repeatSearch, deepWork, belowAvg];
