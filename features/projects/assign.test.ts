// features/projects/assign.test.ts
//
// §15.4 MANDATORY test — "SA never assignable (both app and DB trigger)", and the contract
// test for §13.4.3 `assignTask` (PUL-403.5).
//
// **This file is the home of a two-layer invariant** (Amendment E / §9.7-4, §9.6: "This rule is
// absolute... reject the assignment at the API. There is no exception path."). PUL-401 shipped
// the `pt_no_sa_assignee` trigger with no regression test and named this file as the place that
// owes it. So the SA case is proved TWICE, on purpose, and the two proofs are not redundant:
//
//   - the APP layer refuses with a typed `GATE:sa_assignee` the UI can render;
//   - the DB layer refuses a statement that never went through the action at all.
//
// Deleting either one leaves a real hole. If the app check were removed, the trigger would
// still block the write — but as a raw Postgres error, which `actionResult` re-throws and
// production redacts into an opaque digest, so the manager would see "Something went wrong"
// instead of "pick someone else". If the trigger were dropped, any future writer that forgets
// the guard (a migration, a script, a later action) could seat the CEO on a delivery task.
//
// Rig: the real easygrowcrm_test database, no DB mocks, no mocked `authorize()` (§15.8). The
// only stub is `auth.api.getSession`. Time is frozen through the clock port.

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, projects, projectTasks, user as userTable } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { assertTestDb, seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { assignTask } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** `tasks[0]` is the seeded unassigned/planned task — the natural subject for an assign. */
function unassignedTask() {
  return seed.tasks[0].id;
}

/** `tasks[1]` is seeded assigned to employees[0] — the subject for unassign/reassign. */
function assignedTask() {
  return seed.tasks[1].id;
}

async function taskRow(taskId: string) {
  const [row] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
  return row;
}

async function auditFor(taskId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, taskId));
}

async function auditCount() {
  return (await db.select().from(auditLog)).length;
}

beforeEach(async () => {
  seed = await seedMinimal();
  setClock(createTestClock(NOW));
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
  __resetNotifications();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The invariant this file exists for, proved at both layers.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('super_admin is never a task assignee — BOTH layers (Amendment E, §9.7-4)', () => {
  it('APP LAYER: assignTask refuses an SA assignee with GATE:sa_assignee, writing nothing', async () => {
    actAs(seed.projectManager.id);

    const before = await taskRow(unassignedTask());
    const auditBefore = await auditCount();

    const failure = expectFail(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.superAdmin.id }),
      'GATE',
      'sa_assignee',
    );

    // A typed GATE carrying our reason — i.e. the ACTION refused, not the database. A trigger
    // rejection is not an AppError at all and would surface as a re-thrown driver error.
    expect(failure.details).toMatchObject({ assigneeId: seed.superAdmin.id });

    // No UPDATE and no audit row survived.
    expect((await taskRow(unassignedTask())).assigneeId).toBe(before.assigneeId);
    expect(await auditCount()).toBe(auditBefore);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('DB LAYER: a raw UPDATE that bypasses the action is rejected by pt_no_sa_assignee', async () => {
    // This write never touches assignTask — it is what a migration, a fix-up script or a future
    // action that forgot the guard would do. Migration 0006's trigger is the only thing between
    // that statement and the CEO holding a delivery task.
    assertTestDb();

    let caught: unknown;
    try {
      await db
        .update(projectTasks)
        .set({ assigneeId: seed.superAdmin.id })
        .where(eq(projectTasks.id, unassignedTask()));
    } catch (error) {
      caught = error;
    }

    expect(caught, 'the raw UPDATE was expected to be rejected by the trigger').toBeInstanceOf(
      Error,
    );

    // Drizzle wraps the driver failure in its own "Failed query" error and keeps the Postgres
    // error as `cause`, so the trigger's message reads off there — the same pattern as
    // features/audit/audit-immutability.test.ts.
    const cause = (caught as Error).cause;
    expect(String((cause as Error | undefined)?.message ?? '')).toMatch(
      /super_admin cannot be a task assignee/,
    );

    // The row is untouched: BEFORE UPDATE means the statement never applied.
    expect((await taskRow(unassignedTask())).assigneeId).toBeNull();
  });

  it('DB LAYER: the trigger also rejects a raw INSERT naming an SA assignee', async () => {
    // `pt_no_sa_assignee` is BEFORE INSERT OR UPDATE OF assignee_id (migration 0006) — the
    // insert arm matters because that is the path a template instantiation would take.
    assertTestDb();

    let caught: unknown;
    try {
      await db.insert(projectTasks).values({
        id: 'pt_raw_insert_probe',
        projectId: seed.project.id,
        category: 'Probe',
        title: 'Raw insert naming the SA',
        assigneeId: seed.superAdmin.id,
        createdBy: seed.projectManager.id,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught, 'the raw INSERT was expected to be rejected by the trigger').toBeInstanceOf(
      Error,
    );
    const cause = (caught as Error).cause;
    expect(String((cause as Error | undefined)?.message ?? '')).toMatch(
      /super_admin cannot be a task assignee/,
    );

    expect(await taskRow('pt_raw_insert_probe')).toBeUndefined();
  });

  it('the two layers are independent: the trigger fires on a role the app check never saw', async () => {
    // Promote a seeded EMPLOYEE to super_admin AFTER the app would have read them, then drive
    // the raw write. This is the case that proves the DB test is not just the app test again:
    // the refusal here depends only on the row's CURRENT role, which the trigger re-reads.
    assertTestDb();
    await db
      .update(userTable)
      .set({ role: 'super_admin' })
      .where(eq(userTable.id, seed.employees[2].id));

    let caught: unknown;
    try {
      await db
        .update(projectTasks)
        .set({ assigneeId: seed.employees[2].id })
        .where(eq(projectTasks.id, unassignedTask()));
    } catch (error) {
      caught = error;
    }

    const cause = (caught as Error | undefined)?.cause;
    expect(String((cause as Error | undefined)?.message ?? '')).toMatch(
      /super_admin cannot be a task assignee/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The rest of the §13.4.3 contract.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('assignTask (§13.4.3)', () => {
  it('assigns an active non-SA: row updated, audit written, assignee notified', async () => {
    actAs(seed.projectManager.id);

    const result = expectOk(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[0].id }),
    );

    expect(result.assigneeId).toBe(seed.employees[0].id);

    const row = await taskRow(unassignedTask());
    expect(row.assigneeId).toBe(seed.employees[0].id);
    expect(row.updatedAt.toISOString()).toBe(NOW.toISOString());
    // §13.4.3 defines no optimistic lock, so nothing bumps `version`.
    expect(row.version).toBe(1);

    const audit = await auditFor(unassignedTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'project_task.assigned',
      resourceType: 'project_task',
      before: { assigneeId: null },
      after: { assigneeId: seed.employees[0].id },
    });

    const sent = __sentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: seed.employees[0].id,
      type: 'task_assigned',
      data: { taskId: unassignedTask() },
    });
  });

  it('unassigns with null: column cleared, audit records the previous holder, nobody notified', async () => {
    actAs(seed.teamLeader.id);

    const result = expectOk(await assignTask({ taskId: assignedTask(), assigneeId: null }));

    expect(result.assigneeId).toBeNull();
    expect((await taskRow(assignedTask())).assigneeId).toBeNull();

    const audit = await auditFor(assignedTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'project_task.assigned',
      before: { assigneeId: seed.employees[0].id },
      after: { assigneeId: null },
    });

    // Nobody to tell — there is no new assignee.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('unassigns a task whose holder has been deactivated (the offboarding path)', async () => {
    // §13.1.4 reassigns a leaver's work, so the guard must NOT run on unassign — otherwise the
    // one operation that resolves a deactivated user's workload would deadlock on their state.
    await db.update(userTable).set({ active: false }).where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.projectManager.id);

    expectOk(await assignTask({ taskId: assignedTask(), assigneeId: null }));

    expect((await taskRow(assignedTask())).assigneeId).toBeNull();
  });

  it('rejects a deactivated assignee with GATE:inactive_assignee', async () => {
    await db.update(userTable).set({ active: false }).where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.projectManager.id);

    const auditBefore = await auditCount();

    expectFail(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[1].id }),
      'GATE',
      'inactive_assignee',
    );

    expect((await taskRow(unassignedTask())).assigneeId).toBeNull();
    expect(await auditCount()).toBe(auditBefore);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('rejects assignment on an archived project with GATE:project_archived', async () => {
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));
    actAs(seed.projectManager.id);

    const auditBefore = await auditCount();

    expectFail(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[0].id }),
      'GATE',
      'project_archived',
    );

    expect((await taskRow(unassignedTask())).assigneeId).toBeNull();
    expect(await auditCount()).toBe(auditBefore);
  });

  it('rejects a missing task with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(
      await assignTask({ taskId: 'pt_does_not_exist', assigneeId: seed.employees[0].id }),
      'NOT_FOUND',
    );
  });

  it('rejects a soft-deleted task with NOT_FOUND', async () => {
    await db
      .update(projectTasks)
      .set({ deletedAt: NOW })
      .where(eq(projectTasks.id, unassignedTask()));
    actAs(seed.projectManager.id);

    expectFail(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[0].id }),
      'NOT_FOUND',
    );
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    actAs(seed.employees[0].id);

    const auditBefore = await auditCount();

    expectFail(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[0].id }),
      'FORBIDDEN',
    );

    // 403.3: this is also the no-self-claim proof. An employee cannot route a task to
    // themselves — §13.4.3 records that there is no self-claim flow at all, and the only
    // writer of `assignee_id` is this MGR-gated action.
    expect((await taskRow(unassignedTask())).assigneeId).toBeNull();
    expect(await auditCount()).toBe(auditBefore);
  });

  it('MUTATION PROOF: that deny is authorize(), not an accident of the fixture', async () => {
    // Same caller, same payload, one role flipped to something §9.6 grants
    // `project_task.assign`. If the FORBIDDEN above came from anywhere but the permission
    // table, this would fail too.
    await db
      .update(userTable)
      .set({ role: 'team_leader' })
      .where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.employees[0].id);

    const result = expectOk(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.employees[1].id }),
    );

    expect(result.assigneeId).toBe(seed.employees[1].id);
  });

  it('MUTATION PROOF: the APP-layer SA refusal is the role check, not the trigger', async () => {
    // Demote the SA to a manager role and re-send the SAME payload. If the app-layer test were
    // actually being satisfied by the DB trigger, this would still fail — the trigger reads the
    // live role, so with the role changed it now permits the write and the action must succeed.
    // Green here means the sa_assignee GATE above came from the role check in the action.
    await db
      .update(userTable)
      .set({ role: 'project_manager' })
      .where(eq(userTable.id, seed.superAdmin.id));
    actAs(seed.projectManager.id);

    const result = expectOk(
      await assignTask({ taskId: unassignedTask(), assigneeId: seed.superAdmin.id }),
    );

    expect(result.assigneeId).toBe(seed.superAdmin.id);
  });

  it('MUTATION PROOF: the DB trigger is genuinely attached to project_tasks', async () => {
    // The DB-layer tests above would also pass if the write failed for some unrelated reason.
    // This pins the mechanism: the trigger exists, by name, on this table — so "the trigger
    // rejected it" is a claim about the schema, not an inference from an error string.
    assertTestDb();

    const rows = await db.execute(sql`
      select tgname from pg_trigger
      where tgrelid = 'project_tasks'::regclass and not tgisinternal
    `);

    expect(rows.rows.map((r) => r.tgname)).toContain('pt_no_sa_assignee');
  });
});
