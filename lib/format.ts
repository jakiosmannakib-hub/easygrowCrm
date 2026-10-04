/**
 * The canonical display formatters — PUL-407.1–2, §14.15 r.1–2, §16 ("one `fmtHM` for time,
 * one `fmtDate` for dates").
 *
 * Every rendered date goes through `fmtDate` and every rendered duration through `fmtHM`. They
 * live in `lib/` rather than `features/projects/` because boards, attendance history, the
 * calendar and the review queue all render through them, not only the task views.
 *
 * Pure and client-safe: no DB, no server-only imports. `fmtDate` reads "today" from the clock
 * port so it freezes in tests like everything else.
 */

import { clock } from './clock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` for Asia/Dhaka. `en-CA` is the locale whose short date is already ISO-ordered. */
const DHAKA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's Asia/Dhaka calendar day as `YYYY-MM-DD`, from `clock.now()` (never the browser zone). */
export function dhakaToday(): string {
  return DHAKA_DAY.format(clock.now());
}

/**
 * An instant's local calendar day and wall-clock time in `timeZone` (an IANA name, e.g.
 * `settings.timezone`): `{ date: 'YYYY-MM-DD', time: 'HH:MM:SS' }`, 24-hour.
 *
 * For server decisions that read the zone from settings (PUL-302's late rule) rather than
 * assume Asia/Dhaka like `dhakaToday`. Pass `clock.now()`; the instant is a parameter so the
 * caller decides which "now" it means. `h23` keeps midnight as `00`, never `24`.
 */
export function localDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

/**
 * A `YYYY-MM-DD` calendar day → `Aug 8, 2026`, always with the year (§14.15 r.2). Adds
 * ` · Today` when it is today in Asia/Dhaka and ` · Overdue` when it is before today — suffixes
 * only, never a replacement for the date.
 *
 * The input is parsed as a string and never becomes a `Date`: a bare `date` column is a Dhaka
 * calendar day (§11.0), and `new Date('2026-08-08')` is UTC midnight, which is how a date
 * silently slips a day. The today/overdue comparison is likewise on the ISO strings, which sort
 * lexicographically in date order.
 *
 * `null` (no due date) → `''`. Anything that is not `YYYY-MM-DD` is returned unchanged rather
 * than rendered as a wrong date.
 *
 * `{ relative: false }` drops the suffix and returns the bare `Aug 8, 2026` (PUL-409). For a
 * surface that already carries its own overdue signal — the Board card's red `Overdue Nd` line,
 * which also knows finished work cannot be late — where the suffix would say it twice. The
 * default stays `true`, so every existing caller's output is unchanged.
 */
export function fmtDate(
  dateStr: string | null,
  { relative = true }: { relative?: boolean } = {},
): string {
  if (dateStr === null) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return dateStr;

  const label = `${month} ${Number(m[3])}, ${m[1]}`;
  if (!relative) return label;
  const today = dhakaToday();
  if (dateStr === today) return `${label} · Today`;
  if (dateStr < today) return `${label} · Overdue`;
  return label;
}

/**
 * Decimal hours → `1h 30m` / `45m` / `2h` / `0m` (§8.2, §14.15 r.1). Storage stays decimal so
 * sums stay exact; this is the UI edge.
 *
 * Rounds to the nearest whole minute FIRST, then splits, so 1.999 renders `2h`, not `1h 60m`.
 * `null` (nothing logged / no estimate) → `-` (a plain hyphen), unlike `fmtDate(null)`'s `''`:
 * an hours cell reads as a column value, where a blank looks like a render bug. (The client
 * export writes an empty cell instead; see `client-export.ts`.) A negative value keeps its sign
 * on the front.
 */
export function fmtHM(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '-';
  const total = Math.round(Math.abs(hours) * 60);
  const sign = hours < 0 && total > 0 ? '-' : '';
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (h === 0) return `${sign}${min}m`;
  if (min === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${min}m`;
}
