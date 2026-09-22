// features/projects/create-task.test.ts
//
// Contract test for §13.4.1 `createTask` (PUL-403 Stage 1).
//
// Same rig as `features/employees/create-employee.test.ts` and the PUL-402 project tests: the
// real easygrowcrm_test database, no DB mocks and no mocked `authorize()` (§15.8) — authz is
// the thing under contract, so mocking it would test nothing. The ONLY stub is
// `auth.api.getSession`, the HTTP session envelope, because a vitest node run has no request
// to read a cookie from. `getSessionUser()` still re-reads `role` and `active` from Postgres
// on every call (§16.5), so every case below is decided by an actual database row.
//
// Time is frozen through the clock port and every date in this file is DERIVED from that
// instant rather than written as a literal — a hardcoded date would drift out of the fixture's
// range the moment `seedFull` moves.
//
// NOT covered here, on purpose: the `pt_no_sa_assignee` DB trigger. §17 assigns that proof to
// PUL-403 Stage 2's `features/projects/assign.test.ts`, which §15.4 requires to show BOTH
// layers in one file. This file proves only the app-layer refusal.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  auditLog,
  projects,
  projectTasks,
  taskChecklistItems,
  user as userTable,
} from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { createTask } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');

/** The frozen instant as a `YYYY-MM-DD` day, so no date literal is hand-written below. */
const TODAY = NOW.toISOString().slice(0, 10);

let seed: FullSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** The minimal §13.4.1 payload; `projectId` comes from the seed, overrides ride on top. */
function payload(over: Partial<Parameters<typeof createTask>[0]> = {}) {
  return {
    projectId: seed.project.id,
    title: 'Fix title tags on 12 service pages',
    category: 'On-page SEO',
    ...over,
  };
}

async function taskCount() {
  return (await db.select().from(projectTasks)).length;
}

async function auditCount() {
  return (await db.select().from(auditLog)).length;
}

beforeEach(async () => {
  // seedFull, not seedMinimal: the cross-project dependency case needs a live task that lives
  // in a DIFFERENT project, which only the second engagement provides.
  seed = await seedFull();
  setClock(createTestClock(NOW));
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
  __resetNotifications();
});

describe('createTask (§13.4.1)', () => {
  it('creates the task, leaves the §11.3 defaults to the DB, and audits it in the same tx', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(
      await createTask(
        payload({
          month: 2,
          description: 'Rewrite to the new pattern',
          dueDate: TODAY,
          estimatedHours: 3.5,
          expectedOutput: 'Updated pages + a diff sheet',
          sopUrl: 'https://sop.test/title-tags',
        }),
      ),
    );

    expect(created.id).toMatch(/^pt_/);

    const [row] = await db.select().from(projectTasks).where(eq(projectTasks.id, created.id));

    expect(row).toMatchObject({
      projectId: seed.project.id,
      title: 'Fix title tags on 12 service pages',
      category: 'On-page SEO',
      month: 2,
      description: 'Rewrite to the new pattern',
      dueDate: TODAY,
      expectedOutput: 'Updated pages + a diff sheet',
      sopUrl: 'https://sop.test/title-tags',
      createdBy: seed.projectManager.id,
      // The columns the action deliberately never sends, so the DB default applies (§11.3).
      status: 'planned',
      priority: 'medium',
      qcRequired: true,
      proofRequired: false,
      clientVisible: false,
      version: 1,
      assigneeId: null,
      dependsOn: null,
      deletedAt: null,
    });

    // numeric(6,2) round-trips as a string; the action converts and the column keeps the scale.
    expect(row.estimatedHours).toBe('3.50');

    // Both timestamps come from the frozen clock port, not from `defaultNow()`.
    expect(row.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(row.updatedAt.toISOString()).toBe(NOW.toISOString());

    const audit = await db.select().from(auditLog).where(eq(auditLog.resourceId, created.id));

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'project_task.created',
      resourceType: 'project_task',
      before: null,
    });
    expect(audit[0].after).toMatchObject({ id: created.id, title: row.title, status: 'planned' });
  });

  it('applies explicit overrides of the defaulted columns', async () => {
    actAs(seed.teamLeader.id);

    const created = expectOk(
      await createTask(
        payload({
          priority: 'urgent',
          qcRequired: false,
          proofRequired: true,
          clientVisible: true,
        }),
      ),
    );

    const [row] = await db.select().from(projectTasks).where(eq(projectTasks.id, created.id));

    expect(row).toMatchObject({
      priority: 'urgent',
      qcRequired: false,
      proofRequired: true,
      clientVisible: true,
      // Still never an input — an override of the others must not disturb it.
      status: 'planned',
    });
  });

  it('seeds task_checklist_items in input order, all undone', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(
      await createTask(payload({ checklist: ['Crawl the site', 'Draft the tags', 'Publish'] })),
    );

    const items = await db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, created.id))
      .orderBy(taskChecklistItems.position);

    expect(items.map((i) => [i.position, i.text, i.done])).toEqual([
      [0, 'Crawl the site', false],
      [1, 'Draft the tags', false],
      [2, 'Publish', false],
    ]);
  });

  it('creates no checklist rows when none are given', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(await createTask(payload()));

    const items = await db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, created.id));

    expect(items).toHaveLength(0);
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    actAs(seed.employees[0].id);

    const tasksBefore = await taskCount();
    const auditBefore = await auditCount();

    expectFail(await createTask(payload()), 'FORBIDDEN');

    // The consequence, not just the code: a denied caller leaves no task and no audit row.
    expect(await taskCount()).toBe(tasksBefore);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('MUTATION PROOF: that deny is authorize(), not an accident of the fixture', async () => {
    // Flip the SAME caller to a role §9.6 grants `project_task.create`, send the IDENTICAL
    // payload, and it must now succeed. If the FORBIDDEN above came from anything other than
    // the permission table, this would fail too and the test above would be proving nothing.
    await db
      .update(userTable)
      .set({ role: 'project_manager' })
      .where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.employees[0].id);

    const created = expectOk(await createTask(payload()));

    expect(created.createdBy).toBe(seed.employees[0].id);
  });

  it('rejects a missing project with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    const tasksBefore = await taskCount();

    expectFail(await createTask(payload({ projectId: 'prj_does_not_exist' })), 'NOT_FOUND');

    expect(await taskCount()).toBe(tasksBefore);
  });

  it('rejects a soft-deleted project with NOT_FOUND', async () => {
    await db.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, seed.project.id));
    actAs(seed.projectManager.id);

    expectFail(await createTask(payload()), 'NOT_FOUND');
  });

  it('rejects an archived project with GATE:project_archived', async () => {
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));
    actAs(seed.projectManager.id);

    const tasksBefore = await taskCount();
    const auditBefore = await auditCount();

    expectFail(await createTask(payload()), 'GATE', 'project_archived');

    expect(await taskCount()).toBe(tasksBefore);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('rejects a deactivated assignee with GATE:inactive_assignee', async () => {
    await db.update(userTable).set({ active: false }).where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.projectManager.id);

    const tasksBefore = await taskCount();

    expectFail(
      await createTask(payload({ assigneeId: seed.employees[1].id })),
      'GATE',
      'inactive_assignee',
    );

    expect(await taskCount()).toBe(tasksBefore);
  });

  it('rejects a super_admin assignee with GATE:sa_assignee at the APP layer', async () => {
    // Amendment E / §9.7-4. The point of this case is that the caller never REACHES the
    // `pt_no_sa_assignee` trigger: it is refused in the action, so the failure arrives as a
    // typed GATE rather than a raw Postgres error that `actionResult` would re-throw. The
    // trigger's own proof is Stage 2's assign.test.ts and is not duplicated here.
    actAs(seed.projectManager.id);

    const tasksBefore = await taskCount();
    const auditBefore = await auditCount();

    const failure = expectFail(
      await createTask(payload({ assigneeId: seed.superAdmin.id })),
      'GATE',
      'sa_assignee',
    );

    // A trigger rejection would not carry our reason or our details — this confirms the layer.
    expect(failure.details).toMatchObject({ assigneeId: seed.superAdmin.id });
    expect(await taskCount()).toBe(tasksBefore);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('rejects dependsOn on a task in another project with GATE:bad_dependency', async () => {
    actAs(seed.projectManager.id);

    const tasksBefore = await taskCount();

    // `extraTasks[0]` is live and healthy — it just belongs to `secondProject`.
    expectFail(
      await createTask(payload({ dependsOn: seed.extraTasks[0].id })),
      'GATE',
      'bad_dependency',
    );

    expect(await taskCount()).toBe(tasksBefore);
  });

  it('rejects dependsOn on a soft-deleted task with GATE:bad_dependency', async () => {
    // Right project, wrong state: a deleted task is not something new work may wait on.
    await db
      .update(projectTasks)
      .set({ deletedAt: NOW })
      .where(eq(projectTasks.id, seed.tasks[0].id));
    actAs(seed.projectManager.id);

    expectFail(
      await createTask(payload({ dependsOn: seed.tasks[0].id })),
      'GATE',
      'bad_dependency',
    );
  });

  it('accepts dependsOn on a live task in the same project', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(await createTask(payload({ dependsOn: seed.tasks[0].id })));

    const [row] = await db
      .select()
      .from(projectTasks)
      .where(and(eq(projectTasks.id, created.id), eq(projectTasks.dependsOn, seed.tasks[0].id)));

    expect(row).toBeDefined();
  });

  it('notifies the assignee with task_assigned when one is set', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(await createTask(payload({ assigneeId: seed.employees[2].id })));

    const sent = __sentNotifications();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: seed.employees[2].id,
      type: 'task_assigned',
      data: { taskId: created.id },
    });
  });

  it('notifies nobody when the task is created unassigned', async () => {
    actAs(seed.projectManager.id);

    expectOk(await createTask(payload()));

    expect(__sentNotifications()).toHaveLength(0);
  });

  it('notifies nobody when the transaction rolled back', async () => {
    // The §12.4 step-5 rule, proven rather than asserted: the notify call sits AFTER `withTx`,
    // so a payload that names an assignee but fails a guard must not reach it.
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));
    actAs(seed.projectManager.id);

    expectFail(
      await createTask(payload({ assigneeId: seed.employees[2].id })),
      'GATE',
      'project_archived',
    );

    expect(__sentNotifications()).toHaveLength(0);
  });
});
