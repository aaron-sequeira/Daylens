import { localDate } from '@worksight/core/date';
import { EARLY_MORNING_MIN, isActiveSample, isLateNight } from '../../day/time';
import type { Rule } from '../snapshot';
import { clock, currentStretch, hm } from '../activity';

const STRETCH_MS = 90 * 60_000;
const NIGHT_OFFSET_MS = EARLY_MORNING_MIN * 60_000; // a night runs until 05:00, so 00:30 belongs to yesterday's night

export const eyeBreak: Rule = (s) => {
  const st = currentStretch(s.samples, s.now, s.lastBreakAt);
  if (!st) return null;
  const n = Math.floor(st.ms / (s.settings.breakIntervalMin * 60_000));
  if (n < 1) return null;
  const d = hm(Math.round(st.ms / 60_000));
  return { ruleId: 'eye_break', kind: 'health', key: `eye_break:${st.start}:${n}`, mini: 'Eye break', stat: d,
    title: 'Give your eyes a break', body: `${d} non-stop. Look at something 6 m away for 20 seconds.`,
    primary: { label: 'Start break', action: 'break_eye' } };
};

export const stretch: Rule = (s) => {
  const st = currentStretch(s.samples, s.now, s.lastBreakAt);
  if (!st) return null;
  const n = Math.floor(st.ms / STRETCH_MS);
  if (n < 1) return null;
  const d = hm(Math.round(st.ms / 60_000));
  return { ruleId: 'stretch', kind: 'health', key: `stretch:${st.start}:${n}`, mini: 'Stretch', stat: d,
    title: 'Stand up & stretch', body: `${d} without a real pause. Stand up, roll your shoulders, grab some water.`,
    primary: { label: 'Stretch with me', action: 'break_stretch' } };
};

export const windDown: Rule = (s) => {
  const st = currentStretch(s.samples, s.now, null);
  // Recent idle buckets keep a stretch "current"; wind_down needs real input since it began.
  if (!st || st.ms <= 0 || !s.samples.some((x) => isActiveSample(x) && x.bucketEnd > st.start)) return null;
  if (!isLateNight(s.now, s.settings.windDownTime)) return null;
  return { ruleId: 'wind_down', kind: 'health', key: `wind_down:${localDate(s.now - NIGHT_OFFSET_MS)}`, mini: 'Wind down', stat: clock(s.settings.windDownTime),
    title: 'Time to wind down', body: `It's past ${clock(s.settings.windDownTime)}. Start winding down so sleep comes easier.`,
    primary: { label: 'OK', action: 'ack' } };
};

export const goal: Rule = (s) => {
  const goalSec = s.settings.dailyGoalMin * 60;
  if (goalSec <= 0) return null;
  const ratio = s.view.screenSec / goalSec;
  const used = hm(Math.round(s.view.screenSec / 60)), target = hm(s.settings.dailyGoalMin);
  if (ratio >= 1) return { ruleId: 'goal_100', kind: 'health', key: `goal_100:${s.date}`, mini: 'Goal reached', stat: used,
    title: 'Daily goal reached', body: `You've hit your ${target} screen goal for today.`, primary: { label: 'OK', action: 'ack' } };
  if (ratio >= 0.8) return { ruleId: 'goal_80', kind: 'health', key: `goal_80:${s.date}`, mini: 'Nearly at goal', stat: used,
    title: 'Nearly at your goal', body: `${used} of your ${target} goal. Plan a screen-free evening?`, primary: { label: 'OK', action: 'ack' } };
  return null;
};
