import type { TravelView } from '../../main/time/travel';

export function travelHeadline(v: TravelView): string {
  const day = `Day ${v.day} of ${v.days}`;
  if (v.back) return `Welcome home — adjusting back · ${day}`;
  const h = Math.round((Math.abs(v.fromHomeMin) / 60) * 2) / 2;
  return `You're ${h} hour${h === 1 ? '' : 's'} ${v.fromHomeMin > 0 ? 'ahead of' : 'behind'} home · ${day}`;
}
