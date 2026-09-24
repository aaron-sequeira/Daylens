import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILE, GOALS, MAX_DISTRACTIONS, ROLES, type Profile } from '../../shared/profileOptions';
import { addDistraction, addMinutes, bubbleFor, cardsFor, clock, MAX_ORBIT_CARDS, profileSummary, STEP_COUNT, summaryFor, toggleDistraction } from './onboardingContent';

const p = (patch: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...patch });
const titles = (step: number, prof: Profile): string[] => cardsFor(step, prof).map((c) => c.title);

describe('time helpers', () => {
  it('formats 12-hour clocks', () => {
    expect(['00:05', '09:00', '12:00', '22:30'].map(clock)).toEqual(['12:05 am', '9:00 am', '12:00 pm', '10:30 pm']);
  });
  it('adds minutes and wraps midnight', () => {
    expect(addMinutes('23:30', 60)).toBe('00:30');
    expect(addMinutes('00:10', -30)).toBe('23:40');
    expect(addMinutes('09:00', 180)).toBe('12:00');
  });
});

describe('cardsFor', () => {
  it('welcome shows the 8 preview cards', () => {
    expect(cardsFor(0, p())).toHaveLength(8);
  });
  it('about-you greets by name and reacts to roles', () => {
    expect(titles(1, p({ name: ' Aaron ', roles: ['dev'] }))).toEqual(['Hi Aaron!', 'VS Code', 'Stack Overflow']);
    expect(titles(1, p())).toEqual(['Hi there!', 'Pick what you do']);
  });
  it('goals show one card per goal', () => {
    expect(titles(2, p({ goals: ['sleep', 'focus'] }))).toEqual(['Wind-down', 'Focus streaks']);
    expect(titles(2, p())).toEqual(['Choose a goal']);
  });
  it('rhythm derives focus window and wind-down', () => {
    expect(titles(3, p({ start: '09:00', bed: '22:30' }))).toEqual(['Day starts 9:00 am', 'Focus 10:00 am–12:00 pm', 'Wind down 10:00 pm', 'Offline by 10:30 pm', '5 days a week']);
  });
  it('handles times around midnight', () => {
    expect(titles(3, p({ start: '23:30', bed: '00:30', days: [6] }))).toEqual(['Day starts 11:30 pm', 'Focus 12:30 am–2:30 am', 'Wind down 12:00 am', 'Offline by 12:30 am', '1 day a week']);
  });
  it('distractions become cards', () => {
    expect(titles(4, p({ distractions: ['Instagram'] }))).toEqual(['Instagram']);
    expect(titles(4, p())).toEqual(['Nothing? Lucky you']);
  });
  it('summary step leads with the name and ends with privacy', () => {
    const t = titles(5, p({ name: 'Aaron', goals: ['focus'] }));
    expect(t[0]).toBe('Aaron');
    expect(t[t.length - 1]).toBe('All on this PC');
  });
  it('never puts more than 10 cards around the orb, even with every answer ticked', () => {
    const maxed = p({ name: 'A', roles: [...ROLES], goals: [...GOALS], distractions: Array.from({ length: 12 }, (_, i) => `app${i}`) });
    for (let s = 0; s < STEP_COUNT; s++) {
      const n = cardsFor(s, maxed).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(MAX_ORBIT_CARDS);
    }
  });
});

describe('bubbleFor', () => {
  it('uses the name and summarises distractions', () => {
    expect(bubbleFor(1, p({ name: 'Aaron' }))).toContain('Aaron');
    expect(bubbleFor(4, p({ distractions: ['Instagram', 'YouTube', 'Reddit'] }))).toBe("Noted. I'll keep a gentle eye on Instagram & YouTube and more.");
    for (let s = 0; s < STEP_COUNT; s++) expect(bubbleFor(s, p()).length).toBeGreaterThan(0);
  });
});

describe('distraction list helpers', () => {
  it('addDistraction trims, collapses whitespace and ignores empty input', () => {
    expect(addDistraction([], '  my   game  ')).toEqual(['my game']);
    expect(addDistraction(['Reddit'], ' \t\n ')).toEqual(['Reddit']);
  });
  it('addDistraction ignores case-insensitive duplicates', () => {
    expect(addDistraction(['YouTube'], 'youtube')).toEqual(['YouTube']);
    expect(addDistraction(['my game'], 'MY  GAME')).toEqual(['my game']);
  });
  it('addDistraction maps a typed preset to its preset label', () => {
    expect(addDistraction([], 'youtube')).toEqual(['YouTube']);
    expect(addDistraction([], 'x / twitter')).toEqual(['X / Twitter']);
  });
  it('addDistraction respects MAX_DISTRACTIONS', () => {
    const full = Array.from({ length: MAX_DISTRACTIONS }, (_, i) => `app${i}`);
    expect(addDistraction(full, 'one more')).toEqual(full);
  });
  it('toggleDistraction removes a case-variant instead of adding a duplicate', () => {
    expect(toggleDistraction(['youtube', 'Reddit'], 'YouTube')).toEqual(['Reddit']);
    expect(toggleDistraction(['Reddit'], 'YouTube')).toEqual(['Reddit', 'YouTube']);
    const full = Array.from({ length: MAX_DISTRACTIONS }, (_, i) => `app${i}`);
    expect(toggleDistraction(full, 'YouTube')).toEqual(full);
  });
  it('the typed-then-preset sequence always yields a list profileInput-style validation accepts', () => {
    const list = toggleDistraction(addDistraction([], 'youtube'), 'YouTube');
    expect(new Set(list.map((s) => s.toLowerCase())).size).toBe(list.length);
    expect(list).toEqual([]);
    expect(addDistraction(toggleDistraction([], 'YouTube'), 'youtube')).toEqual(['YouTube']);
  });
});

describe('summaries', () => {
  it('summaryFor has four rows and handles skipped answers', () => {
    const rows = summaryFor(p());
    expect(rows).toHaveLength(4);
    expect(rows[0].strong).toBe('a bit of everything');
    expect(rows[3].strong).toBe('');
  });
  it('profileSummary lists what Daylens knows', () => {
    expect(profileSummary(null)).toBe('');
    expect(profileSummary(p())).toBe('Nothing yet. Answer a few questions to personalise Daylens.');
    expect(profileSummary(p({ roles: ['dev'], goals: ['focus'], distractions: ['Instagram'] }))).toBe('Coding · Deeper focus · watching Instagram');
  });
});
