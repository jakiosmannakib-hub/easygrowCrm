// features/attendance/late.ts
//
// The late rule (§10.2, §13.5.1, PUL-302). Pure: no DB, no clock; the caller supplies the local
// day and time (`localDateTime(clock.now(), settings.timezone)`) and whether the day is a holiday.

import { weekday } from '../../lib/dates';
import type { Settings } from '../settings/queries';

/** `HH:MM[:SS]` → whole minutes since midnight. Seconds are dropped on purpose. */
function minuteOfDay(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Late means all three:
 *   1. the day is a work day (`settings.work_days`, 0 = Sunday), and
 *   2. it is not a holiday, and
 *   3. the local time is at or after `grace_in` + 1 minute.
 *
 * Rule 3 compares whole minutes, so with `grace_in` 09:15 anything up to 09:15:59 is on time
 * and 09:16:00 is late. A sign-in on a weekend or holiday is never late: nobody is expected in.
 */
export function isLateSignIn(
  local: { date: string; time: string },
  rules: Pick<Settings, 'workDays' | 'graceIn'>,
  isHoliday: boolean,
): boolean {
  if (!rules.workDays.includes(weekday(local.date))) return false;
  if (isHoliday) return false;
  return minuteOfDay(local.time) >= minuteOfDay(rules.graceIn) + 1;
}
