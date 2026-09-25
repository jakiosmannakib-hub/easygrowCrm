// features/templates/cascade.test.ts — PUL-504
//
// The Add Month wizard's 12-month date cascade (§14.4.3). PURE test: no db module, no
// `assertTestDb`.

import { describe, expect, it } from 'vitest';
import { cascadeMonthDates, daysInMonth, MONTH_NAMES } from './cascade';

describe('daysInMonth', () => {
  it('uses fixed month lengths, with February at 29', () => {
    expect([...Array(12).keys()].map(daysInMonth)).toEqual([
      31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  it('rejects a month outside 0..11', () => {
    expect(() => daysInMonth(12)).toThrow(RangeError);
    expect(() => daysInMonth(-1)).toThrow(RangeError);
  });
});

describe('MONTH_NAMES', () => {
  it('is 0-based, January first', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('January');
    expect(MONTH_NAMES[8]).toBe('September');
  });
});

describe('cascadeMonthDates', () => {
  it('Sep 10: 12 entries, wrapping past December, day unchanged', () => {
    const dates = cascadeMonthDates(8, 10);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toEqual({ month: 8, day: 10 });
    expect(dates[1]).toEqual({ month: 9, day: 10 });
    expect(dates[3]).toEqual({ month: 11, day: 10 });
    expect(dates[4]).toEqual({ month: 0, day: 10 });
    expect(dates[11]).toEqual({ month: 7, day: 10 });
    expect(dates.map((d) => d.month)).toEqual([8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('Jan 31: clamps each month from the START day, not the previous entry', () => {
    const dates = cascadeMonthDates(0, 31);
    expect(dates[0]).toEqual({ month: 0, day: 31 });
    expect(dates[1]).toEqual({ month: 1, day: 29 }); // Feb clamped
    expect(dates[2]).toEqual({ month: 2, day: 31 }); // Mar back to 31
    expect(dates[3]).toEqual({ month: 3, day: 30 }); // Apr clamped
    expect(dates.map((d) => d.day)).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it('Feb 29: entry 0 is kept, and no later month needs clamping below 29', () => {
    const dates = cascadeMonthDates(1, 29);
    expect(dates[0]).toEqual({ month: 1, day: 29 });
    expect(dates.every((d) => d.day === 29)).toBe(true);
    expect(dates[11]).toEqual({ month: 0, day: 29 });
  });

  it('Jan 1: no clamping, every day is 1', () => {
    const dates = cascadeMonthDates(0, 1);
    expect(dates.map((d) => d.day)).toEqual(Array(12).fill(1));
    expect(dates.map((d) => d.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('does not clamp entry 0, even past its month length', () => {
    // The caller validated it; the cascade only clamps the months it derives.
    expect(cascadeMonthDates(3, 31)[0]).toEqual({ month: 3, day: 31 });
    expect(cascadeMonthDates(3, 31)[1]).toEqual({ month: 4, day: 31 });
  });
});
