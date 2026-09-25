import { MAX_DISTRACTIONS, type Goal, type Profile, type Role } from '../../shared/profileOptions';

export interface OrbitCard { icon: string; title: string; sub: string; color: string }
export interface SummaryRow { icon: string; color: string; text: string; strong: string }
export const STEP_COUNT = 7;
export const MAX_ORBIT_CARDS = 10;

function c(icon: string, title: string, sub: string, color: string): OrbitCard {
  return { icon, title, sub, color };
}

export const ROLE_INFO: Record<Role, { emoji: string; label: string; color: string; cards: OrbitCard[] }> = {
  student: { emoji: '🎓', label: 'Studying', color: 'var(--mint)', cards: [c('🎓', 'YouTube lectures', 'counts as Learning', 'var(--mint)'), c('📓', 'Notion', 'counts as Study', 'var(--mint)')] },
  dev: { emoji: '💻', label: 'Coding', color: 'var(--lav)', cards: [c('💻', 'VS Code', 'counts as Work', 'var(--lav)'), c('🧩', 'Stack Overflow', 'counts as Learning', 'var(--mint)')] },
  design: { emoji: '🎨', label: 'Design', color: 'var(--pink)', cards: [c('🎨', 'Figma', 'counts as Work', 'var(--pink)'), c('✨', 'Dribbble', 'counts as Inspiration', 'var(--peach)')] },
  office: { emoji: '📊', label: 'Office work', color: 'var(--sky)', cards: [c('📊', 'Excel', 'counts as Work', 'var(--sky)'), c('📧', 'Outlook', 'counts as Comms', 'var(--sky)')] },
  create: { emoji: '🎬', label: 'Creating content', color: 'var(--peach)', cards: [c('🎬', 'Premiere Pro', 'counts as Creating', 'var(--peach)'), c('📺', 'YouTube Studio', 'counts as Work', 'var(--peach)')] },
  game: { emoji: '🎮', label: 'Gaming', color: 'var(--pink)', cards: [c('🎮', 'Steam', 'counts as Play', 'var(--pink)'), c('💬', 'Discord', 'counts as Social', 'var(--lav)')] },
  browse: { emoji: '🌐', label: 'Browsing & chilling', color: 'var(--mint)', cards: [c('🌐', 'Chrome', 'sorted by what you read', 'var(--mint)')] }
};

export const GOAL_INFO: Record<Goal, { emoji: string; title: string; sub: string; color: string; card: OrbitCard }> = {
  less: { emoji: '⏳', title: 'Less screen time', sub: 'Stay under a daily goal', color: 'var(--mint)', card: c('⏳', 'Daily goal', 'gentle reminders', 'var(--mint)') },
  focus: { emoji: '🧠', title: 'Deeper focus', sub: 'Longer stretches, fewer switches', color: 'var(--lav)', card: c('🧠', 'Focus streaks', 'I celebrate 60+ min', 'var(--lav)') },
  sleep: { emoji: '🌙', title: 'Better sleep', sub: 'Log off on time', color: 'var(--sky)', card: c('🌙', 'Wind-down', 'nudge before bedtime', 'var(--sky)') },
  breaks: { emoji: '👀', title: 'Healthier breaks', sub: 'Eyes, posture, movement', color: 'var(--peach)', card: c('👀', '20-20-20', 'eye breaks every 50 min', 'var(--peach)') },
  distract: { emoji: '📵', title: 'Fewer distractions', sub: 'Catch doomscrolling early', color: 'var(--pink)', card: c('📵', 'Scroll alerts', 'after 20 min of feeds', 'var(--pink)') },
  better: { emoji: '🛠', title: 'Work smarter', sub: "Tips when I'm stuck", color: 'var(--mint)', card: c('🛠', 'Stuck tips', 'when errors repeat', 'var(--mint)') }
};

export const DISTRACTION_CHOICES: { emoji: string; label: string }[] = [
  { emoji: '📸', label: 'Instagram' }, { emoji: '▶️', label: 'YouTube' }, { emoji: '🎵', label: 'TikTok' },
  { emoji: '👽', label: 'Reddit' }, { emoji: '✖️', label: 'X / Twitter' }, { emoji: '💬', label: 'Discord' },
  { emoji: '🍿', label: 'Netflix' }, { emoji: '🎮', label: 'Games' }, { emoji: '📰', label: 'News' }
];

const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Add a typed distraction: whitespace-collapsed, case-insensitively unique, preset spelling when it names a preset, capped. */
export function addDistraction(list: string[], raw: string): string[] {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v || list.length >= MAX_DISTRACTIONS || list.some((d) => sameText(d, v))) return list;
  return [...list, DISTRACTION_CHOICES.find((c) => sameText(c.label, v))?.label ?? v];
}

/** Toggle a preset chip; a case-variant already in the list counts as selected and is removed. */
export function toggleDistraction(list: string[], label: string): string[] {
  return list.some((d) => sameText(d, label)) ? list.filter((d) => !sameText(d, label)) : addDistraction(list, label);
}

const WELCOME: OrbitCard[] = [
  c('⏱', '6h 12m', 'on screen today', 'var(--lav)'), c('✦', '90-min focus', 'streak', 'var(--mint)'),
  c('📊', 'Your week', 'at a glance', 'var(--peach)'), c('💚', 'Health 72', 'pretty healthy', 'var(--pink)'),
  c('👀', 'Eye break', 'in 12 min', 'var(--sky)'), c('🎧', 'Spotify', '39m · background', 'var(--lav)'),
  c('📚', 'Learning', '48m today', 'var(--mint)'), c('🌙', 'Wind-down', '11:00 pm', 'var(--peach)')
];

export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const cap = (cards: OrbitCard[]): OrbitCard[] => cards.slice(0, MAX_ORBIT_CARDS);
const focusWindow = (p: Profile): string => `${clock(addMinutes(p.start, 60))}–${clock(addMinutes(p.start, 180))}`;

export function cardsFor(step: number, p: Profile): OrbitCard[] {
  const name = p.name.trim();
  switch (step) {
    case 0:
      return WELCOME;
    case 1: {
      const roles = p.roles.flatMap((r) => ROLE_INFO[r].cards);
      return cap([c('👋', name ? `Hi ${name}!` : 'Hi there!', 'nice to meet you', 'var(--lav)'), ...(roles.length ? roles : [c('🤔', 'Pick what you do', 'I learn from it', 'var(--panel)')])]);
    }
    case 2:
      return p.goals.length ? cap(p.goals.map((g) => GOAL_INFO[g].card)) : [c('🎯', 'Choose a goal', 'or two, or all', 'var(--panel)')];
    case 3:
      return [
        c('☀️', `Day starts ${clock(p.start)}`, 'deep work 1–3h after', 'var(--peach)'),
        c('🧠', `Focus ${focusWindow(p)}`, 'your best hours', 'var(--lav)'),
        c('🌙', `Wind down ${clock(addMinutes(p.bed, -30))}`, 'soft nudge', 'var(--sky)'),
        c('🛌', `Offline by ${clock(p.bed)}`, 'sleep protected', 'var(--lav)'),
        c('📅', `${p.days.length} day${p.days.length === 1 ? '' : 's'} a week`, 'weekends stay gentle', 'var(--mint)')
      ];
    case 4:
      return p.distractions.length ? cap(p.distractions.map((d) => c('👀', d, 'gentle eye on it', 'var(--pink)'))) : [c('🧲', 'Nothing? Lucky you', 'or pick a few', 'var(--panel)')];
    case 5:
      return [
        c('💻', 'Coding in VS Code', 'work', 'var(--lav)'),
        c('📺', 'Watching YouTube', 'entertainment', 'var(--peach)'),
        c('📚', 'Reading docs', 'learning', 'var(--mint)'),
        c('💬', 'Team chat', 'communication', 'var(--sky)'),
        c('🔒', 'Text only, on this PC', 'screenshot never saved', 'var(--mint)')
      ];
    default:
      return cap([
        c('👋', name || 'Friend', p.roles.length ? `${p.roles.length} kind${p.roles.length === 1 ? '' : 's'} of work` : 'all-rounder', 'var(--lav)'),
        ...p.goals.slice(0, 3).map((g) => GOAL_INFO[g].card),
        c('🌙', `Offline by ${clock(p.bed)}`, 'wind-down on', 'var(--sky)'),
        ...p.distractions.slice(0, 3).map((d) => c('👀', d, 'watching gently', 'var(--pink)')),
        c('🔒', 'All on this PC', 'always private', 'var(--mint)')
      ]);
  }
}

export function bubbleFor(step: number, p: Profile, screen = false): string {
  const name = p.name.trim();
  switch (step) {
    case 0: return "Hi! I'm Daylens. Let's get to know each other.";
    case 1: return name ? `Lovely to meet you, ${name}. What do you do here?` : 'What should I call you?';
    case 2: return p.goals.length ? `Got it: ${p.goals.length} goal${p.goals.length > 1 ? 's' : ''}. I'll focus on those.` : "Pick what you want help with. I won't nag about the rest.";
    case 3: return `I'll protect ${focusWindow(p)} for deep work and nudge you before ${clock(p.bed)}.`;
    case 4:
      return p.distractions.length
        ? `Noted. I'll keep a gentle eye on ${p.distractions.slice(0, 2).join(' & ')}${p.distractions.length > 2 ? ' and more' : ''}.`
        : 'Anything that steals your time? Totally optional.';
    case 5: return screen ? "Thanks! I'll learn what you're working on, privately." : 'Totally optional. Everything else works without it.';
    default: return `Ready when you are${name ? `, ${name}` : ''}! Your dashboard fills in as you use your PC.`;
  }
}

export function summaryFor(p: Profile): SummaryRow[] {
  return [
    p.roles.length
      ? { icon: '🧑‍💻', color: 'var(--lav)', text: 'You use this PC for', strong: p.roles.map((r) => ROLE_INFO[r].label).join(', ') }
      : { icon: '🧑‍💻', color: 'var(--lav)', text: 'You do', strong: 'a bit of everything' },
    p.goals.length
      ? { icon: '🎯', color: 'var(--peach)', text: "I'll help with", strong: p.goals.map((g) => GOAL_INFO[g].title).join(', ') }
      : { icon: '🎯', color: 'var(--peach)', text: "I'll give", strong: 'balanced nudges' },
    { icon: '🌙', color: 'var(--sky)', text: 'Deep work', strong: `${focusWindow(p)}, wind-down before ${clock(p.bed)}` },
    p.distractions.length
      ? { icon: '👀', color: 'var(--pink)', text: 'Gentle eye on', strong: p.distractions.join(', ') }
      : { icon: '👀', color: 'var(--pink)', text: 'No distraction watch-list (you can add one later)', strong: '' }
  ];
}

export function profileSummary(p: Profile | null): string {
  if (!p) return '';
  const parts = [
    p.roles.map((r) => ROLE_INFO[r].label).join(', '),
    p.goals.map((g) => GOAL_INFO[g].title).join(', '),
    p.distractions.length ? `watching ${p.distractions.join(', ')}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing yet. Answer a few questions to personalise Daylens.';
}
