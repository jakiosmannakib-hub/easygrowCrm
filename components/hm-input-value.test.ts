// components/hm-input-value.test.ts (PUL-302 Stage 2): <HMInput>'s decimal <-> H/M helpers.

import { describe, expect, it } from 'vitest';
import { hourChoices, joinHours, MINUTE_CHOICES, splitHours } from './hm-input-value';

describe('splitHours', () => {
  it('splits decimal hours into hours and 5-minute steps', () => {
    expect(splitHours(1.5)).toEqual({ hours: 1, minutes: 30 });
    expect(splitHours(0.25)).toEqual({ hours: 0, minutes: 15 });
    expect(splitHours(2)).toEqual({ hours: 2, minutes: 0 });
  });

  it('snaps the total, so nothing renders as 60 minutes', () => {
    expect(splitHours(1.99)).toEqual({ hours: 2, minutes: 0 });
  });

  it('reads a numeric(6,2)-rounded value back as the step it came from', () => {
    // 1h 5m is 1.0833..., stored as 1.08.
    expect(splitHours(1.08)).toEqual({ hours: 1, minutes: 5 });
    expect(splitHours(0.42)).toEqual({ hours: 0, minutes: 25 });
  });

  it('treats null, negative and non-finite as nothing chosen', () => {
    expect(splitHours(null)).toEqual({ hours: null, minutes: null });
    expect(splitHours(-1)).toEqual({ hours: null, minutes: null });
    expect(splitHours(Number.NaN)).toEqual({ hours: null, minutes: null });
  });
});

describe('joinHours', () => {
  it('joins hours and minutes into decimal hours', () => {
    expect(joinHours({ hours: 1, minutes: 30 })).toBe(1.5);
    expect(joinHours({ hours: 0, minutes: 45 })).toBe(0.75);
  });

  it('counts an unset half as 0, and both unset as no value', () => {
    expect(joinHours({ hours: null, minutes: 30 })).toBe(0.5);
    expect(joinHours({ hours: 3, minutes: null })).toBe(3);
    expect(joinHours({ hours: null, minutes: null })).toBeNull();
  });

  it('round-trips every 5-minute step through 2-decimal storage', () => {
    for (let h = 0; h <= 3; h++) {
      for (const m of MINUTE_CHOICES) {
        const stored = Number(joinHours({ hours: h, minutes: m })!.toFixed(2));
        expect(splitHours(stored)).toEqual({ hours: h, minutes: m });
      }
    }
  });
});

describe('choices', () => {
  it('offers minutes 0 to 55 in 5s and hours 0 to 24, widened for a larger value', () => {
    expect(MINUTE_CHOICES).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(hourChoices(null)).toHaveLength(25);
    expect(hourChoices(30).at(-1)).toBe(30);
  });
});
