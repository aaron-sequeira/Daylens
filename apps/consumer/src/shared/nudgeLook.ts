import type { Kind } from '../main/coach/types';

// Colours/emoji per pill-v2.html.
export const NUDGE_LOOK: Record<Kind, { color: string; emoji: string; label: string }> = {
  health: { color: '#BFEBD3', emoji: '👁', label: 'Health' },
  behaviour: { color: '#F4C6C8', emoji: '↻', label: 'Behaviour' },
  tip: { color: '#D8D2FC', emoji: '💡', label: 'Tip' },
  win: { color: '#F9DDB9', emoji: '★', label: 'Win' }
};
