// features/templates/cascade.ts — PUL-504, §14.4.3
//
// The Add Month wizard's date cascade: from Month 1's start (month + day), the start of each of
// the 12 months in a cycle, with the day clamped to what each month can hold.
//
// Pure: no DB, no clock, no I/O, and no `Date`. A template month has no year (its dates only
// become real when Start Project resolves them against a project, PUL-505/506), so the month
// lengths are fixed and February is 29: a recurring template must not lose Feb 29 in a leap year.
// Clamping to the real length of a given year's February is the resolver's job, not this one's.

/** Month names by `start_month` (0-based, 0 = January, §11.4). */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The most days each month can have. February is 29 (see the file header). */
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** The most days month `month` (0..11) can have. */
export function daysInMonth(month: number): number {
  const days = MAX_DAYS[month];
  if (days === undefined) throw new RangeError(`month must be 0..11, got ${month}`);
  return days;
}

export interface MonthStart {
  /** 0..11 */
  month: number;
  /** 1..31 */
  day: number;
}

/**
 * The 12 month starts of a cycle beginning at `startMonth` / `startDay`.
 *
 * Entry 0 is the start exactly as given: the caller has already validated it, and it is NOT
 * clamped here. Entry i (1..11) is the month `i` later, wrapping past December, with the day
 * clamped to that month's maximum. The clamp is always from `startDay`, never from the previous
 * entry, so a Jan 31 cycle goes Feb 29 → Mar 31, not Feb 29 → Mar 29.
 */
export function cascadeMonthDates(startMonth: number, startDay: number): MonthStart[] {
  return Array.from({ length: 12 }, (_, i) => {
    if (i === 0) return { month: startMonth, day: startDay };
    const month = (startMonth + i) % 12;
    return { month, day: Math.min(startDay, daysInMonth(month)) };
  });
}
