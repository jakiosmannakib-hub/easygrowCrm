// features/attendance/sign-in.test.ts (PUL-302.5)
//
// §13.5.1 `signIn` and the sign-in prefill, under a frozen clock against the real test DB.
//
// Dates: 2026-10-04 is a Sunday (a work day), 2026-10-09 a Friday (weekend). Asia/Dhaka is
// UTC+6, so 09:16 local is 03:16Z.
//
// `next/cache` is mocked because `revalidatePath` throws outside a Next request; the session is
// mocked the same way status-transitions.test.ts does it.

import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  attendance,
  auditLog,
  dailyTasks,
  holidays,
  projects,
  projectTasks,
  user as userTable,
} from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { expectNotified } from '../../tests/notifications';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { signIn } = await import('./actions');
const { getMyToday, getSignInPrefill } = await import('./queries');

const SUNDAY = '2026-10-04';
const clock = createTestClock(new Date('2026-10-04T03:00:00Z')); // Sun 09:00 Dhaka, on time

let seed: MinimalSeed;
let me: string;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function rowCount(table: typeof attendance | typeof dailyTasks | typeof auditLog) {
  const [{ n }] = await db.select({ n: count() }).from(table);
  return n;
}

/** A project task for the prefill / linking cases. Defaults: mine, planned, due today. */
function task(
  id: string,
  values: Partial<typeof projectTasks.$inferInsert> = {},
): typeof projectTasks.$inferInsert {
  return {
    id,
    projectId: seed.project.id,
    category: 'Content',
    title: `Task ${id}`,
    createdBy: seed.projectManager.id,
    assigneeId: me,
    status: 'planned',
    dueDate: SUNDAY,
    ...values,
  };
}

beforeEach(async () => {
  seed = await seedMinimal();
  me = seed.employees[0].id;
  await db.insert(userTable).values([
    { id: 'test_hr', name: 'Test HR', email: 'hr@test.local', role: 'admin_hr', emailVerified: true, active: true },
    { id: 'test_hr_off', name: 'Old HR', email: 'hr2@test.local', role: 'admin_hr', emailVerified: true, active: false },
  ]);
  setClock(clock);
  clock.set(new Date('2026-10-04T03:00:00Z'));
  __resetNotifications();
  revalidatePath.mockClear();
  actAs(me);
});

afterEach(() => {
  resetClock();
});

describe('late detection', () => {
  it('is on time at 09:15:30 on a work day', async () => {
    clock.set(new Date('2026-10-04T03:15:30Z'));
    const result = expectOk(await signIn({ workType: 'in_office', plan: [] }));
    expect(result.late).toBe(false);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('is late at 09:16:00, and notifies active HR and nobody else', async () => {
    clock.set(new Date('2026-10-04T03:16:00Z'));
    const result = expectOk(await signIn({ workType: 'remote', plan: [] }));
    expect(result.late).toBe(true);

    const [row] = await db.select().from(attendance).where(eq(attendance.id, result.attendanceId));
    expect(row).toMatchObject({ late: true, workType: 'remote', date: SUNDAY, employeeId: me });

    expectNotified('test_hr', {
      type: 'signed_in_late',
      data: { employeeName: 'Seed Employee One', date: SUNDAY, time: '09:16' },
    });
    expect(__sentNotifications().map((n) => n.to)).toEqual(['test_hr']);
  });

  it('is never late on a Friday, however late the hour', async () => {
    clock.set(new Date('2026-10-09T05:00:00Z')); // Fri 11:00 Dhaka
    const result = expectOk(await signIn({ workType: 'in_office', plan: [] }));
    expect(result.late).toBe(false);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('is never late on a holiday', async () => {
    await db.insert(holidays).values({ date: SUNDAY, name: 'Test holiday' });
    clock.set(new Date('2026-10-04T05:00:00Z')); // Sun 11:00 Dhaka
    const result = expectOk(await signIn({ workType: 'in_office', plan: [] }));
    expect(result.late).toBe(false);
  });

  it("writes today's local date at 00:30, not yesterday's UTC date", async () => {
    clock.set(new Date('2026-10-04T18:30:00Z')); // Mon Oct 5, 00:30 Dhaka
    const result = expectOk(await signIn({ workType: 'remote', plan: [] }));
    expect(result.date).toBe('2026-10-05');
    const [row] = await db.select().from(attendance).where(eq(attendance.id, result.attendanceId));
    expect(row.date).toBe('2026-10-05');
  });
});

describe('already signed in', () => {
  it('refuses a second sign-in the same day with CONFLICT and writes nothing more', async () => {
    expectOk(await signIn({ workType: 'in_office', plan: [{ title: 'First plan' }] }));
    const before = {
      attendance: await rowCount(attendance),
      plan: await rowCount(dailyTasks),
      audit: await rowCount(auditLog),
    };

    clock.advance(60 * 60 * 1000);
    const fail = expectFail(
      await signIn({ workType: 'remote', plan: [{ title: 'Second plan' }] }),
      'CONFLICT',
      'already_signed_in',
    );
    expect(fail.message).toBe("You're already signed in today.");

    expect({
      attendance: await rowCount(attendance),
      plan: await rowCount(dailyTasks),
      audit: await rowCount(auditLog),
    }).toEqual(before);
  });
});

describe('the plan', () => {
  beforeEach(async () => {
    await db.insert(projectTasks).values([
      task('t_planned', { title: 'Write the brief' }),
      task('t_progress', { status: 'in_progress' }),
      task('t_revision', { status: 'revision_required', dueDate: '2026-10-01' }),
      task('t_other', { assigneeId: seed.employees[1].id }),
    ]);
  });

  it('writes the rows, moves only planned tasks to in_progress, and audits both', async () => {
    const result = expectOk(
      await signIn({
        workType: 'in_office',
        plan: [
          { title: 'Typed title', projectTaskId: 't_planned' },
          { title: 'x', projectTaskId: 't_progress' },
          { title: 'x', projectTaskId: 't_revision' },
          { title: '  Ad-hoc call  ', clientId: seed.client.id, estimatedHours: 1.5 },
        ],
      }),
    );
    expect(result.movedTaskIds).toEqual(['t_planned']);

    const rows = await db.select().from(dailyTasks).where(eq(dailyTasks.employeeId, me));
    expect(rows).toHaveLength(4);
    const linked = rows.find((r) => r.projectTaskId === 't_planned');
    expect(linked).toMatchObject({ title: 'Write the brief', date: SUNDAY, priority: 'medium' });
    const adHoc = rows.find((r) => r.projectTaskId === null);
    expect(adHoc).toMatchObject({ title: 'Ad-hoc call', clientId: seed.client.id, estimatedHours: '1.50' });

    const statuses = await db
      .select({ id: projectTasks.id, status: projectTasks.status, version: projectTasks.version })
      .from(projectTasks);
    const byId = new Map(statuses.map((s) => [s.id, s]));
    expect(byId.get('t_planned')).toMatchObject({ status: 'in_progress', version: 2 });
    expect(byId.get('t_progress')).toMatchObject({ status: 'in_progress', version: 1 });
    expect(byId.get('t_revision')).toMatchObject({ status: 'revision_required', version: 1 });

    const audit = await db.select().from(auditLog);
    expect(audit.filter((a) => a.action === 'project_task.status_changed')).toEqual([
      expect.objectContaining({
        resourceType: 'project_task',
        resourceId: 't_planned',
        actorId: me,
        before: { status: 'planned', version: 1 },
        after: { status: 'in_progress', version: 2 },
      }),
    ]);
    expect(audit.find((a) => a.action === 'attendance.signed_in')).toMatchObject({
      resourceType: 'attendance',
      resourceId: result.attendanceId,
      after: {
        date: SUNDAY,
        workType: 'in_office',
        late: false,
        planRows: 4,
        linkedTaskIds: ['t_planned', 't_progress', 't_revision'],
      },
    });

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    expect(revalidatePath).toHaveBeenCalledWith('/projects');

    // getMyToday sees the day and the plan, with each linked task's current status.
    const today = await getMyToday();
    expect(today.attendance).toMatchObject({ id: result.attendanceId, late: false });
    expect(today.plan).toHaveLength(4);
    expect(today.plan.find((r) => r.projectTaskId === 't_planned')).toMatchObject({
      projectName: seed.project.name,
      projectTaskStatus: 'in_progress',
      isOverdue: false,
    });
    // The card's Overdue pill and "Ad-hoc, {Client}" line (PUL-302 Stage 2).
    expect(today.plan.find((r) => r.projectTaskId === 't_revision')?.isOverdue).toBe(true);
    expect(today.plan.find((r) => r.projectTaskId === null)).toMatchObject({
      clientName: seed.client.name,
      isOverdue: false,
    });
  });

  it("refuses someone else's task with FORBIDDEN naming the row, and writes nothing", async () => {
    const fail = expectFail(
      await signIn({ workType: 'in_office', plan: [{ title: 'Their task', projectTaskId: 't_other' }] }),
      'FORBIDDEN',
      'task_not_plannable',
    );
    expect(fail.message).toBe('"Their task" is not an open task assigned to you.');
    expect(await rowCount(attendance)).toBe(0);
    expect(await rowCount(dailyTasks)).toBe(0);
  });

  it('refuses the same task twice with VALIDATION', async () => {
    expectFail(
      await signIn({
        workType: 'in_office',
        plan: [
          { title: 'a', projectTaskId: 't_planned' },
          { title: 'b', projectTaskId: 't_planned' },
        ],
      }),
      'VALIDATION',
      'duplicate_task',
    );
    expect(await rowCount(attendance)).toBe(0);
  });

  it('accepts an empty plan', async () => {
    const result = expectOk(await signIn({ workType: 'client_site', plan: [] }));
    expect(result.movedTaskIds).toEqual([]);
    expect(await rowCount(attendance)).toBe(1);
    expect(await rowCount(dailyTasks)).toBe(0);
  });
});

describe('getSignInPrefill', () => {
  it('offers my open tasks due today or overdue, overdue first, and nothing else', async () => {
    await db.insert(projects).values({
      id: 'proj_archived',
      name: 'Old Project',
      accountId: seed.account.id,
      type: 'Retainer',
      startDate: '2026-01-01',
      status: 'archived',
      createdBy: seed.projectManager.id,
    });
    await db.insert(projectTasks).values([
      task('t_today_high', { title: 'B today high', priority: 'high' }),
      task('t_today_low', { title: 'A today low', status: 'in_progress', priority: 'low' }),
      task('t_overdue', { title: 'Z overdue', status: 'revision_required', dueDate: '2026-10-01', priority: 'low' }),
      task('t_future', { dueDate: '2026-10-05' }),
      task('t_other', { assigneeId: seed.employees[1].id }),
      task('t_submitted', { status: 'submitted' }),
      task('t_approved', { status: 'approved' }),
      task('t_cancelled', { status: 'cancelled' }),
      task('t_archived', { projectId: 'proj_archived' }),
    ]);

    const rows = await getSignInPrefill();
    expect(rows.map((r) => r.id)).toEqual(['t_overdue', 't_today_high', 't_today_low']);
    expect(rows[0]).toEqual({
      id: 't_overdue',
      title: 'Z overdue',
      projectName: seed.project.name,
      status: 'revision_required',
      dueDate: '2026-10-01',
      isOverdue: true,
    });
    expect(rows[1].isOverdue).toBe(false);
  });
});
