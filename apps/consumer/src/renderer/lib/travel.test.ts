import { describe, it, expect } from 'vitest';
import { travelHeadline } from './travel';

const v = { direction: 'east' as const, fromHomeMin: 480, back: false, day: 1, days: 3, endsAt: 0, tips: [] };
describe('travelHeadline', () => {
  it('ahead / behind / half hours / back home', () => {
    expect(travelHeadline(v)).toBe("You're 8 hours ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: -300, direction: 'west', day: 2 })).toBe("You're 5 hours behind home · Day 2 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 330 })).toBe("You're 5.5 hours ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 60 })).toBe("You're 1 hour ahead of home · Day 1 of 3");
    expect(travelHeadline({ ...v, fromHomeMin: 0, back: true })).toBe('Welcome home — adjusting back · Day 1 of 3');
  });
});
