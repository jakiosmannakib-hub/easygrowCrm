// features/attendance/schema.test.ts (PUL-301)
//
// The attendance-side DB rules (§11.5 to §11.8), proved with raw inserts and updates that
// bypass every action: no action exists yet (PUL-302 onward), and these constraints are the
// layer that must hold when someone writes SQL by hand.
//
// Each case pins the exact constraint (or trigger) that refused the write, by SQLSTATE plus
// constraint name or message, so an unrelated failure cannot pass for the rule.
//
// Rig: the real easygrowcrm_test database (§15.7). seedMinimal supplies users only; it adds
// no attendance rows by design.

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { attendance, attendanceBreaks, eodReports, settings } from '../../db/schema';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

let seed: MinimalSeed;
let employeeId: string;

beforeEach(async () => {
  seed = await seedMinimal();
  employeeId = seed.employees[0].id;
});

const DAY = '2026-10-04';
const NINE = new Date('2026-10-04T03:00:00Z'); // 09:00 Asia/Dhaka
const TEN = new Date('2026-10-04T04:00:00Z'); // 10:00 Asia/Dhaka
const ELEVEN = new Date('2026-10-04T05:00:00Z'); // 11:00 Asia/Dhaka

/**
 * Drizzle wraps a driver failure in "Failed query" and keeps the Postgres error as `cause`
 * (same pattern as qc-required-check.test.ts). Returns that cause for the caller to pin.
 */
async function pgError(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'the write was expected to be refused').toBeInstanceOf(Error);
  return ((caught as Error).cause ?? caught) as {
    code?: string;
    constraint?: string;
    message?: string;
  };
}

async function expectViolation(
  run: () => Promise<unknown>,
  code: '23505' | '23514',
  constraint: string,
) {
  const cause = await pgError(run);
  // 23505 = unique_violation, 23514 = check_violation.
  expect(cause.code).toBe(code);
  expect(cause.constraint).toBe(constraint);
}

/** A raw attendance day: the minimum §11.5 requires, plus overrides. */
function insertDay(id: string, values: Partial<typeof attendance.$inferInsert> = {}) {
  return db.insert(attendance).values({
    id,
    employeeId,
    date: DAY,
    workType: 'in_office',
    signInAt: NINE,
    ...values,
  });
}

function insertEod(id: string, values: Partial<typeof eodReports.$inferInsert> = {}) {
  return db.insert(eodReports).values({ id, employeeId, date: DAY, explanation: 'All done', ...values });
}

describe('attendance', () => {
  it('refuses a second row for the same employee and date (one_row_per_day)', async () => {
    await insertDay('att_1');
    await expectViolation(() => insertDay('att_2', { workType: 'remote' }), '23505', 'one_row_per_day');
  });

  it("refuses sign_out_type 'early' with no early_reason (early_needs_reason)", async () => {
    await expectViolation(
      () => insertDay('att_1', { signOutAt: ELEVEN, signOutType: 'early', earlyReason: null }),
      '23514',
      'early_needs_reason',
    );
  });

  it('refuses sign_out_at at or before sign_in_at (signout_after_signin)', async () => {
    await expectViolation(
      () => insertDay('att_1', { signOutAt: NINE, signOutType: 'normal' }),
      '23514',
      'signout_after_signin',
    );
  });
});

describe('attendance_breaks', () => {
  beforeEach(async () => {
    await insertDay('att_1');
  });

  it('refuses a second open break (one_open_break); after the first ends, another succeeds', async () => {
    await db
      .insert(attendanceBreaks)
      .values({ id: 'brk_1', attendanceId: 'att_1', type: 'lunch', startedAt: NINE });
    await expectViolation(
      () =>
        db
          .insert(attendanceBreaks)
          .values({ id: 'brk_2', attendanceId: 'att_1', type: 'prayer', startedAt: TEN }),
      '23505',
      'one_open_break',
    );

    await db
      .update(attendanceBreaks)
      .set({ endedAt: TEN, minutes: 60 })
      .where(eq(attendanceBreaks.id, 'brk_1'));
    await db
      .insert(attendanceBreaks)
      .values({ id: 'brk_2', attendanceId: 'att_1', type: 'prayer', startedAt: TEN });

    const rows = await db.select().from(attendanceBreaks).where(eq(attendanceBreaks.attendanceId, 'att_1'));
    expect(rows).toHaveLength(2);
  });

  it('refuses ended_at at or before started_at (ended_after_start)', async () => {
    await expectViolation(
      () =>
        db
          .insert(attendanceBreaks)
          .values({ id: 'brk_1', attendanceId: 'att_1', type: 'lunch', startedAt: TEN, endedAt: TEN }),
      '23514',
      'ended_after_start',
    );
  });
});

describe('settings', () => {
  it('holds exactly one row with the §10.1 defaults, and refuses id 2', async () => {
    const rows = await db.select().from(settings);
    expect(rows).toEqual([
      {
        id: 1,
        companyName: 'My company',
        timezone: 'Asia/Dhaka',
        workDays: [0, 1, 2, 3, 4],
        shiftStart: '09:00:00',
        shiftEnd: '18:00:00',
        graceIn: '09:15:00',
        workTargetMin: 420,
        halfTargetMin: 210,
        breakAllowanceMin: 60,
        halfBreakAllowanceMin: 30,
        autoCloseHours: 10,
        webhookUrl: null,
      },
    ]);

    await expectViolation(
      () => db.insert(settings).values({ id: 2, companyName: 'Second' }),
      '23514',
      'settings_id_check',
    );
  });
});

describe('eod_reports', () => {
  beforeEach(async () => {
    await insertEod('eod_1');
  });

  it('refuses an update to report content (eod_reports_immutable)', async () => {
    const cause = await pgError(() =>
      db.update(eodReports).set({ explanation: 'Rewritten' }).where(eq(eodReports.id, 'eod_1')),
    );
    // P0001 = raise_exception from the trigger.
    expect(cause.code).toBe('P0001');
    expect(cause.message).toMatch(/eod_reports content is immutable/);
  });

  it('allows the acknowledgment: reviewed_at and reviewed_by together', async () => {
    await db
      .update(eodReports)
      .set({ reviewedAt: ELEVEN, reviewedBy: seed.projectManager.id, flagged: true, managerNote: 'Talk' })
      .where(eq(eodReports.id, 'eod_1'));
    const [row] = await db.select().from(eodReports).where(eq(eodReports.id, 'eod_1'));
    expect(row).toMatchObject({ reviewedBy: seed.projectManager.id, flagged: true, explanation: 'All done' });
  });

  it('refuses reviewed_at without reviewed_by (ack_complete)', async () => {
    await expectViolation(
      () => db.update(eodReports).set({ reviewedAt: ELEVEN }).where(eq(eodReports.id, 'eod_1')),
      '23514',
      'ack_complete',
    );
  });

  it('refuses a self-acknowledgment (no_self_ack)', async () => {
    await expectViolation(
      () =>
        db
          .update(eodReports)
          .set({ reviewedAt: ELEVEN, reviewedBy: employeeId })
          .where(eq(eodReports.id, 'eod_1')),
      '23514',
      'no_self_ack',
    );
  });

  it('refuses DELETE (eod_reports_immutable)', async () => {
    const cause = await pgError(() => db.delete(eodReports).where(eq(eodReports.id, 'eod_1')));
    expect(cause.code).toBe('P0001');
    expect(cause.message).toMatch(/eod_reports is immutable: DELETE is not permitted/);
  });

  it('refuses a second report for the same employee and date (one_report_per_day)', async () => {
    await expectViolation(() => insertEod('eod_2'), '23505', 'one_report_per_day');
  });

  it('is still wiped by TRUNCATE, which reset() relies on', async () => {
    await db.execute(sql`TRUNCATE TABLE "eod_reports"`);
    expect(await db.select().from(eodReports)).toHaveLength(0);
  });
});
