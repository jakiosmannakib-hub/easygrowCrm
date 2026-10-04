// components/hm-input-value.ts (PUL-302 Stage 2, §14.15 r.1)
//
// The pure half of <HMInput>: decimal hours in and out, hours + minutes in between. Storage
// stays decimal (`numeric(6,2)`); the UI edits paired H / M in 5-minute steps.
//
// No imports on purpose: client-safe and testable without the `@/` alias.

/** The minute step the picker offers. */
export const MINUTE_STEP = 5;

/** The minute choices: 0, 5, ... 55. */
export const MINUTE_CHOICES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/** The hour choices: 0 to 24. A larger stored value is still shown (see `hourChoices`). */
const BASE_HOUR_CHOICES = Array.from({ length: 25 }, (_, i) => i);

export interface HMParts {
  hours: number | null;
  minutes: number | null;
}

/**
 * Decimal hours → `{ hours, minutes }`, minutes snapped to the nearest 5-minute step. Snapping
 * the TOTAL first means 1.99 becomes 2h 0m, never 1h 60m, and a stored 1.08 (1h 5m after
 * `numeric(6,2)` rounding) comes back as 1h 5m. `null` or a negative / non-finite value → both
 * null (nothing chosen).
 */
export function splitHours(value: number | null): HMParts {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return { hours: null, minutes: null };
  }
  const total = Math.round((value * 60) / MINUTE_STEP) * MINUTE_STEP;
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * `{ hours, minutes }` → decimal hours. Both unset → `null` (no value). One set → the other
 * counts as 0, so picking only "30m" means half an hour. Not rounded: the caller's storage
 * (`toFixed(2)`) decides precision, and `splitHours` snaps it back on the way in.
 */
export function joinHours(parts: HMParts): number | null {
  if (parts.hours === null && parts.minutes === null) return null;
  return ((parts.hours ?? 0) * 60 + (parts.minutes ?? 0)) / 60;
}

/** The hour choices, widened to include `current` when a stored value is above 24h. */
export function hourChoices(current: number | null): number[] {
  return current !== null && current > 24 ? [...BASE_HOUR_CHOICES, current] : BASE_HOUR_CHOICES;
}
