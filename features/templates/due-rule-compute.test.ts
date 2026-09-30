// features/templates/due-rule-compute.test.ts — PUL-505.3, §15.4 mandatory
//
// `computeDueDates`, §13.3.2's month-aware due-rule resolver. Every expected date below is
// hand-computed and its weekday checked against an independent calendar (GNU `date`), not
// derived from `lib/dates`:
//
//   2026-09-06 Sun · 09-08 Tue · 09-10 Thu · 09-11 Fri · 09-13 Sun · 09-14 Mon
//   2026-10-15 Thu · 10-17 Sat · 10-21 Wed · 10-22 Thu · 10-23 Fri · 10-25 Sun
//   2026-11-06 Fri · 11-08 Sun
//   2027-01-31 Sun · 2027-02-28 Sun · 2027-03-31 Wed · 2028-01-31 Mon · 2028-02-29 Tue
//
// Mutation proofs:
//   - making `isWorkingDay` ignore the weekend (Fri/Sat) fails the Friday-shift,
//     holiday-then-weekend, the before_deadline weekend cases and after-before-weekend;
//   - swapping `before_deadline`'s `shiftBackToWorkingDay` for the forward `shiftToWorkingDay`
//     fails every before_deadline case that lands on a non-working day;
//   - dropping the Month 0 floor (`_monthNum - 1` instead of `max(_monthNum, 1) - 1`) fails the
//     three Onboarding day-rule cases (PUL-419).
//
// PURE test: no db module, no pool, no `assertTestDb`.

import { describe, expect, it } from 'vitest';
import type { DueRule } from '../../db/schema/templates';
import { computeDueDates, type DueRuleContext, type DueRuleTask } from './due-rule-compute';

function task(id: string, dueRule: DueRule, monthNum = 1): DueRuleTask {
  return { id, dueRule, _monthNum: monthNum };
}

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/** Project starting Sunday 2026-09-06, deadline Thursday 2026-10-22, no holidays. */
function ctx(over: Partial<DueRuleContext> = {}): DueRuleContext {
  return { startDate: '2026-09-06', deadline: '2026-10-22', holidays: NO_HOLIDAYS, ...over };
}

/** The dates of a result that must have succeeded, as a plain object for readable diffs. */
function datesOf(result: ReturnType<typeof computeDueDates>): Record<string, string> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason} on ${result.taskId}`);
  return Object.fromEntries(result.dates);
}

describe('day rule', () => {
  it('Month 1: start + (n − 1)', () => {
    expect(datesOf(computeDueDates([task('a', { kind: 'day', n: 3 })], ctx()))).toEqual({
      a: '2026-09-08', // Sun 09-06 + 2 = Tue
    });
  });

  it('Month 3: anchors to start + 2 calendar months, and the month start is not shifted', () => {
    // Month 3 starts Fri 2026-11-06. Day 3 = Sun 11-08. Had the month start been shifted to
    // Sun 11-08 first, Day 3 would be Tue 11-10.
    expect(datesOf(computeDueDates([task('a', { kind: 'day', n: 3 }, 3)], ctx()))).toEqual({
      a: '2026-11-08',
    });
  });

  it('Day 0 equals Day 1', () => {
    const result = computeDueDates(
      [task('zero', { kind: 'day', n: 0 }), task('one', { kind: 'day', n: 1 })],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ zero: '2026-09-06', one: '2026-09-06' });
  });
});

describe('Month 0, the Onboarding month (PUL-419): anchored on the start date like Month 1', () => {
  it('day rules land on the same dates as the same days of Month 1', () => {
    const result = computeDueDates(
      [
        task('onb1', { kind: 'day', n: 1 }, 0),
        task('onb3', { kind: 'day', n: 3 }, 0),
        task('m1d3', { kind: 'day', n: 3 }, 1),
        // Day 7 = Sat 09-12 → shifted forward to Sun 09-13.
        task('onb7', { kind: 'day', n: 7 }, 0),
      ],
      ctx(),
    );
    expect(datesOf(result)).toEqual({
      onb1: '2026-09-06',
      onb3: '2026-09-08',
      m1d3: '2026-09-08',
      onb7: '2026-09-13',
    });
  });

  it('does NOT start a month before the project: a Jan 31 start keeps Onboarding in January', () => {
    // Without the anchor, Month 0 would start at start − 1 month = 2026-12-31.
    const result = computeDueDates(
      [task('onb', { kind: 'day', n: 1 }, 0)],
      ctx({ startDate: '2027-01-31', deadline: null }),
    );
    expect(datesOf(result)).toEqual({ onb: '2027-01-31' });
  });

  it('after and before_deadline rules behave as in any other month', () => {
    const result = computeDueDates(
      [
        task('onb3', { kind: 'day', n: 3 }, 0), // Tue 09-08
        task('next', { kind: 'after', ref: 'onb3' }, 1), // + 1 working day = Wed 09-09
        task('late', { kind: 'before_deadline', n: 0 }, 0), // the deadline, Thu 10-22
      ],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ onb3: '2026-09-08', next: '2026-09-09', late: '2026-10-22' });
  });
});

describe('month start clamps to the real calendar', () => {
  it('Jan 31, 2027 → Month 2 starts Feb 28 (non-leap)', () => {
    const result = computeDueDates(
      [task('m2', { kind: 'day', n: 1 }, 2)],
      ctx({ startDate: '2027-01-31', deadline: null }),
    );
    expect(datesOf(result)).toEqual({ m2: '2027-02-28' }); // Sun, a working day
  });

  it('Jan 31, 2028 → Month 2 starts Feb 29 (leap)', () => {
    const result = computeDueDates(
      [task('m2', { kind: 'day', n: 1 }, 2)],
      ctx({ startDate: '2028-01-31', deadline: null }),
    );
    expect(datesOf(result)).toEqual({ m2: '2028-02-29' }); // Tue
  });

  it('clamps from the start day, not the previous month: Jan 31 → Month 3 is Mar 31', () => {
    const result = computeDueDates(
      [task('m3', { kind: 'day', n: 1 }, 3)],
      ctx({ startDate: '2027-01-31', deadline: null }),
    );
    expect(datesOf(result)).toEqual({ m3: '2027-03-31' }); // Wed
  });
});

describe('shift forward off non-working days', () => {
  it('a Friday shifts to Sunday', () => {
    // Day 6 = Fri 09-11 → Sat skipped → Sun 09-13.
    expect(datesOf(computeDueDates([task('a', { kind: 'day', n: 6 })], ctx()))).toEqual({
      a: '2026-09-13',
    });
  });

  it('a holiday shifts to the next working day', () => {
    // Day 3 = Tue 09-08, a holiday → Wed 09-09.
    const result = computeDueDates(
      [task('a', { kind: 'day', n: 3 })],
      ctx({ holidays: new Set(['2026-09-08']) }),
    );
    expect(datesOf(result)).toEqual({ a: '2026-09-09' });
  });

  it('a holiday followed by a weekend and another holiday shifts past all of them', () => {
    // Day 5 = Thu 09-10 (holiday) → Fri, Sat (weekend) → Sun 09-13 (holiday) → Mon 09-14.
    const result = computeDueDates(
      [task('a', { kind: 'day', n: 5 })],
      ctx({ holidays: new Set(['2026-09-10', '2026-09-13']) }),
    );
    expect(datesOf(result)).toEqual({ a: '2026-09-14' });
  });
});

describe('before_deadline rule (shifts BACKWARD, never past the deadline)', () => {
  it('deadline − n, shifted back off a weekend', () => {
    const result = computeDueDates(
      [
        task('n7', { kind: 'before_deadline', n: 7 }), // Thu 10-15
        task('n5', { kind: 'before_deadline', n: 5 }), // Sat 10-17 → Fri skipped → Thu 10-15
      ],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ n7: '2026-10-15', n5: '2026-10-15' });
  });

  it('n = 0 is the deadline itself', () => {
    expect(
      datesOf(computeDueDates([task('a', { kind: 'before_deadline', n: 0 })], ctx())),
    ).toEqual({ a: '2026-10-22' });
  });

  it('a Friday deadline with n = 0 → the Thursday before', () => {
    const result = computeDueDates(
      [task('a', { kind: 'before_deadline', n: 0 })],
      ctx({ deadline: '2026-10-23' }),
    );
    expect(datesOf(result)).toEqual({ a: '2026-10-22' });
  });

  it('a deadline on a holiday → the working day before it', () => {
    // Thu 10-22 is a holiday → Wed 10-21.
    const result = computeDueDates(
      [task('a', { kind: 'before_deadline', n: 0 })],
      ctx({ holidays: new Set(['2026-10-22']) }),
    );
    expect(datesOf(result)).toEqual({ a: '2026-10-21' });
  });

  it('a holiday deadline after a weekend shifts back past all of them', () => {
    // Sun 10-25 (holiday) → Sat, Fri (weekend) → Thu 10-22 (holiday) → Wed 10-21.
    const result = computeDueDates(
      [task('a', { kind: 'before_deadline', n: 0 })],
      ctx({ deadline: '2026-10-25', holidays: new Set(['2026-10-25', '2026-10-22']) }),
    );
    expect(datesOf(result)).toEqual({ a: '2026-10-21' });
  });

  it('no deadline → no_deadline, naming the task', () => {
    const result = computeDueDates(
      [task('ok', { kind: 'day', n: 1 }), task('needs', { kind: 'before_deadline', n: 3 })],
      ctx({ deadline: null }),
    );
    expect(result).toEqual({ ok: false, reason: 'no_deadline', taskId: 'needs' });
  });

  it('no deadline is fine when no task needs one', () => {
    const result = computeDueDates([task('a', { kind: 'day', n: 1 })], ctx({ deadline: null }));
    expect(result.ok).toBe(true);
  });
});

describe('after rule', () => {
  it("the referenced task's due + 1 working day", () => {
    const result = computeDueDates(
      [task('a', { kind: 'day', n: 3 }), task('b', { kind: 'after', ref: 'a' })],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ a: '2026-09-08', b: '2026-09-09' });
  });

  it('a chain A → B → C resolves when given in reverse order', () => {
    const result = computeDueDates(
      [
        task('c', { kind: 'after', ref: 'b' }),
        task('b', { kind: 'after', ref: 'a' }),
        task('a', { kind: 'day', n: 3 }),
      ],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ a: '2026-09-08', b: '2026-09-09', c: '2026-09-10' });
  });

  it('a ref due on a Thursday → the next working day is Sunday', () => {
    const result = computeDueDates(
      [task('thu', { kind: 'day', n: 5 }), task('next', { kind: 'after', ref: 'thu' })],
      ctx(),
    );
    expect(datesOf(result)).toEqual({ thu: '2026-09-10', next: '2026-09-13' });
  });

  it('bad_ref when the ref does not resolve', () => {
    const result = computeDueDates(
      [task('a', { kind: 'day', n: 1 }), task('b', { kind: 'after', ref: 'missing' })],
      ctx(),
    );
    expect(result).toEqual({ ok: false, reason: 'bad_ref', taskId: 'b' });
  });

  it('bad_ref on a cycle', () => {
    const result = computeDueDates(
      [task('a', { kind: 'after', ref: 'b' }), task('b', { kind: 'after', ref: 'a' })],
      ctx(),
    );
    // Walking from `a` reaches `b`, whose ref back to `a` closes the cycle.
    expect(result).toEqual({ ok: false, reason: 'bad_ref', taskId: 'b' });
  });

  it('bad_ref on a self-reference', () => {
    const result = computeDueDates([task('a', { kind: 'after', ref: 'a' })], ctx());
    expect(result).toEqual({ ok: false, reason: 'bad_ref', taskId: 'a' });
  });
});
