// features/projects/calendar.test.ts — PUL-411
//
// Not a §15.4 mandatory file. The unit-lane guard on the Calendar's pure helpers in display.ts:
// the month grid (leading/trailing days, week count), bucketing tasks onto their due day from the
// `YYYY-MM-DD` string, and Prev/Next month arithmetic across the year boundary. No render, no DB,
// and no `Date` in the code under test — which is exactly what these cases pin.

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_WEEKDAYS,
  bucketTasksByDay,
  calendarGrid,
  calendarMonthOf,
  calendarMonthTitle,
  shiftCalendarMonth,
} from './display';

describe('calendarGrid', () => {
  it('pads a month that starts mid-week — Sep 2026 starts on a Tuesday', () => {
    const weeks = calendarGrid({ year: 2026, month: 9 });
    expect(weeks).toHaveLength(5);
    expect(weeks[0]!.map((d) => d.iso)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(weeks[0]!.map((d) => d.inMonth)).toEqual([false, false, true, true, true, true, true]);
    // Trailing: Sep 30 is a Wednesday, so Oct 1–3 fill the last week.
    expect(weeks[4]!.slice(-3).map((d) => [d.iso, d.inMonth])).toEqual([
      ['2026-10-01', false],
      ['2026-10-02', false],
      ['2026-10-03', false],
    ]);
  });

  it('needs no padding at all when the 1st is a Sunday and the month is 28 days — Feb 2026', () => {
    const weeks = calendarGrid({ year: 2026, month: 2 });
    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every((d) => d.inMonth)).toBe(true);
    expect(weeks[0]![0]!.iso).toBe('2026-02-01');
  });

  it('runs to six weeks when a 31-day month starts on a Saturday — Aug 2026', () => {
    const weeks = calendarGrid({ year: 2026, month: 8 });
    expect(weeks).toHaveLength(6);
    expect(weeks[0]!.filter((d) => !d.inMonth)).toHaveLength(6);
    expect(weeks[0]![6]!.iso).toBe('2026-08-01');
  });

  it('always yields whole weeks containing every day of the month exactly once', () => {
    for (let month = 1; month <= 12; month++) {
      const cells = calendarGrid({ year: 2026, month }).flat();
      expect(cells.length % 7).toBe(0);
      const inMonth = cells.filter((d) => d.inMonth).map((d) => d.day);
      expect(inMonth).toEqual(Array.from({ length: inMonth.length }, (_, i) => i + 1));
    }
  });

  it('takes leading days from a leap February — Mar 2024 starts on a Friday', () => {
    const lead = calendarGrid({ year: 2024, month: 3 })[0]!.filter((d) => !d.inMonth);
    expect(lead.map((d) => d.iso)).toEqual([
      '2024-02-25',
      '2024-02-26',
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
    ]);
  });

  it('pads across the year boundary — Jan 2026 leads with Dec 2025', () => {
    // Jan 1, 2026 is a Thursday → four leading days from December 2025.
    const lead = calendarGrid({ year: 2026, month: 1 })[0]!.filter((d) => !d.inMonth);
    expect(lead.map((d) => d.iso)).toEqual(['2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31']);
  });

  it('starts the week on Sunday, matching the header', () => {
    expect(CALENDAR_WEEKDAYS[0]).toBe('Sun');
    // Sep 6, 2026 is a Sunday — the first cell of the second row.
    expect(calendarGrid({ year: 2026, month: 9 })[1]![0]!.iso).toBe('2026-09-06');
  });
});

describe('bucketTasksByDay', () => {
  it('places each task on its due-date string, keeping input order within a day', () => {
    const buckets = bucketTasksByDay([
      { id: 'a', dueDate: '2026-09-24' },
      { id: 'b', dueDate: '2026-09-01' },
      { id: 'c', dueDate: '2026-09-24' },
    ]);
    expect(buckets.get('2026-09-24')?.map((t) => t.id)).toEqual(['a', 'c']);
    expect(buckets.get('2026-09-01')?.map((t) => t.id)).toEqual(['b']);
  });

  it('omits an undated task — it has no day to sit on', () => {
    const buckets = bucketTasksByDay([
      { id: 'a', dueDate: null },
      { id: 'b', dueDate: '2026-09-02' },
    ]);
    expect([...buckets.values()].flat().map((t) => t.id)).toEqual(['b']);
  });

  it('omits a malformed date rather than guessing a day for it', () => {
    expect(bucketTasksByDay([{ id: 'a', dueDate: 'Sep 2' }]).size).toBe(0);
  });

  it('keys match the grid’s cells, so a cell finds its tasks by string equality', () => {
    const buckets = bucketTasksByDay([{ id: 'a', dueDate: '2026-10-02' }]);
    const cell = calendarGrid({ year: 2026, month: 9 })
      .flat()
      .find((d) => d.iso === '2026-10-02');
    // A trailing (next-month) cell still shows its task.
    expect(cell?.inMonth).toBe(false);
    expect(buckets.get(cell!.iso)?.map((t) => t.id)).toEqual(['a']);
  });
});

describe('Prev / Next month arithmetic', () => {
  it('moves within a year', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 9 }, 1)).toEqual({ year: 2026, month: 10 });
    expect(shiftCalendarMonth({ year: 2026, month: 9 }, -1)).toEqual({ year: 2026, month: 8 });
  });

  it('rolls Dec → Jan into the next year', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls Jan → Dec into the previous year', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('handles multi-month jumps in both directions', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
    expect(shiftCalendarMonth({ year: 2026, month: 11 }, 14)).toEqual({ year: 2028, month: 1 });
  });
});

describe('calendarMonthOf / calendarMonthTitle', () => {
  it('derives the month from a YYYY-MM-DD string, without a Date', () => {
    expect(calendarMonthOf('2026-09-24')).toEqual({ year: 2026, month: 9 });
    expect(calendarMonthOf('2027-01-01')).toEqual({ year: 2027, month: 1 });
  });

  it('titles the header with the year, always', () => {
    expect(calendarMonthTitle({ year: 2026, month: 9 })).toBe('September 2026');
    expect(calendarMonthTitle({ year: 2027, month: 1 })).toBe('January 2027');
  });
});
