import { describe, it, expect } from 'vitest';
import { formatHm, formatClock, hourLabel, appInitials, appColor, joinApps, healthLabel, greeting } from './format';

describe('format', () => {
  it('formatHm', () => {
    expect(formatHm(22320)).toBe('6h 12m');
    expect(formatHm(2880)).toBe('48m');
    expect(formatHm(3600)).toBe('1h');
    expect(formatHm(7260)).toBe('2h 1m');
    expect(formatHm(20)).toBe('0m');
    expect(formatHm(0)).toBe('0m');
    expect(formatHm(-5)).toBe('0m');
  });
  it('formatClock', () => {
    expect(formatClock(new Date(2026, 8, 23, 8, 12).getTime())).toBe('8:12 am');
    expect(formatClock(new Date(2026, 8, 23, 15, 5).getTime())).toBe('3:05 pm');
    expect(formatClock(new Date(2026, 8, 23, 0, 0).getTime())).toBe('12:00 am');
  });
  it('hourLabel', () => {
    expect([0, 8, 12, 14, 24].map(hourLabel)).toEqual(['12 am', '8 am', '12 pm', '2 pm', '12 am']);
  });
  it('appInitials', () => {
    expect(appInitials('Google Chrome')).toBe('GC');
    expect(appInitials('Discord')).toBe('D');
    expect(appInitials('deadlock.exe')).toBe('D');
    expect(appInitials('Windows Terminal Host')).toBe('WT');
  });
  it('appColor is stable per app', () => {
    expect(appColor('Discord')).toBe(appColor('Discord'));
    expect(appColor('Discord')).toMatch(/^hsl\(\d+ 55% 52%\)$/);
  });
  it('joinApps', () => {
    expect(joinApps(['A'])).toBe('A');
    expect(joinApps(['A', 'B'])).toBe('A & B');
    expect(joinApps(['A', 'B', 'C'])).toBe('A, B & C');
  });
  it('healthLabel', () => {
    expect([90, 75, 60, 10].map(healthLabel)).toEqual(['Pretty healthy', 'Pretty healthy', 'Could use a break', 'Rough day']);
  });
});

describe('greeting', () => {
  it('greets by time of day', () => {
    expect([5, 11, 12, 17, 18, 23, 0, 4].map((h) => greeting(h, 'Aaron'))).toEqual([
      'Good morning, Aaron', 'Good morning, Aaron', 'Good afternoon, Aaron', 'Good afternoon, Aaron',
      'Good evening, Aaron', 'Good evening, Aaron', 'Good evening, Aaron', 'Good evening, Aaron'
    ]);
  });
  it('is empty without a name', () => {
    expect(greeting(9, '')).toBe('');
    expect(greeting(9, '   ')).toBe('');
  });
});
