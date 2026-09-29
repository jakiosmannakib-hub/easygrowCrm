/**
 * Calendar-day and working-day math on `YYYY-MM-DD` strings — PUL-505, §13.3.2, §12 (dates).
 *
 * Every `date` column is an Asia/Dhaka calendar day (§11.0, §12), so a day is handled as a plain
 * `YYYY-MM-DD` string and never becomes a `Date`: `new Date('2026-08-08')` is UTC midnight, which
 * is how a day silently slips across an offset. All arithmetic goes through a day number
 * (Howard Hinnant's `days_from_civil` / `civil_from_days`), pure integers.
 *
 * Pure and client-safe: no clock, no DB, no I/O. "Today" is not in here; it is `dhakaToday()` in
 * `lib/format.ts`, which reads the clock port.
 *
 * The civil-day core (`dayNumber`, `isoFromDayNumber`, `isoDay`, `daysInMonth`) moved here from
 * `features/projects/display.ts` so the due-rule resolver (PUL-505) and the leave working-day
 * math (PUL-702) share one copy with the Calendar and the client export.
 */

/** Zero-padded `YYYY-MM-DD` from parts. `month` is 1-based. */
export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days in a Gregorian month (`month` 1-based). Pure arithmetic, leap-year aware. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` calendar day → a day number (Hinnant's `days_from_civil`), or `null` if the
 * string is not `YYYY-MM-DD`. The epoch is arbitrary: use it for differences only.
 */
export function dayNumber(iso: string): number | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const [y0, mo, d] = m.slice(1).map(Number) as [number, number, number];
  const y = mo <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

/** The inverse of `dayNumber` (Hinnant's `civil_from_days`). */
export function isoFromDayNumber(z: number): string {
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return isoDay(y, m, d);
}

/** `dayNumber`, but a malformed day is a programming error, not a value to carry on with. */
function requireDayNumber(iso: string): number {
  const n = dayNumber(iso);
  if (n === null) throw new RangeError(`expected a YYYY-MM-DD day, got "${iso}"`);
  return n;
}

/** Move a `YYYY-MM-DD` day by `days` (may be negative). Month, year and leap rollover included. */
export function addDays(iso: string, days: number): string {
  return isoFromDayNumber(requireDayNumber(iso) + days);
}

/**
 * Move a `YYYY-MM-DD` day by `months` calendar months, clamping the day to the target month's
 * real length: `2027-01-31` + 1 → `2027-02-28`, `2028-01-31` + 1 → `2028-02-29`.
 *
 * The clamp is always from the input's day, never chained: callers stepping a cycle should add
 * `k` months to the ORIGINAL start (Jan 31 → Feb 28 → Mar 31), not 1 month to the previous step.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const m = ISO_DAY.exec(iso);
  if (!m) throw new RangeError(`expected a YYYY-MM-DD day, got "${iso}"`);
  const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
  const total = y * 12 + (mo - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return isoDay(year, month, Math.min(d, daysInMonth(year, month)));
}

/** The day number of 1970-01-01, a Thursday: the known reference `weekday` measures from. */
const THURSDAY_1970 = requireDayNumber('1970-01-01');

/** Day of the week, `0` = Sunday … `6` = Saturday. */
export function weekday(iso: string): number {
  return (((requireDayNumber(iso) - THURSDAY_1970 + 4) % 7) + 7) % 7;
}

/** The agency's weekend: Friday (5) and Saturday (6). The work week is Sun–Thu (§3.2, §13.6.1). */
const WEEKEND = new Set([5, 6]);

/** A working day: Sun–Thu and not in `holidays` (a set of `YYYY-MM-DD` days). */
export function isWorkingDay(iso: string, holidays: ReadonlySet<string>): boolean {
  return !WEEKEND.has(weekday(iso)) && !holidays.has(iso);
}

/**
 * `iso` if it is a working day, otherwise the first working day after it. Skips forward past
 * any run of weekend days and holidays together (a Thursday holiday → the following Sunday).
 */
export function shiftToWorkingDay(iso: string, holidays: ReadonlySet<string>): string {
  let day = iso;
  while (!isWorkingDay(day, holidays)) day = addDays(day, 1);
  return day;
}

/**
 * `iso` if it is a working day, otherwise the last working day before it. The backward twin of
 * `shiftToWorkingDay`, for dates that must not move later (a Sunday holiday → the Thursday before).
 */
export function shiftBackToWorkingDay(iso: string, holidays: ReadonlySet<string>): string {
  let day = iso;
  while (!isWorkingDay(day, holidays)) day = addDays(day, -1);
  return day;
}

/** The first working day strictly after `iso`. */
export function nextWorkingDay(iso: string, holidays: ReadonlySet<string>): string {
  return shiftToWorkingDay(addDays(iso, 1), holidays);
}
