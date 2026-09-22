// features/projects/subtask.test.ts
//
// PUL-405 Stage 1 — §13.4.9 `addSubtask` / `toggleSubtask` / `deleteSubtask`.
//
// Not a §15.4 mandatory file (the manifest is unchanged). Covers the permission cell
// (`project_task.subtask_manage`: MGR anywhere, EMP only as assignee, HR never), the
// post-submission lock (EMP-only — managers edit through it, §13.4.9), the idempotent toggle,
// NOT_FOUND paths, position ordering, and the audit row each write leaves.
//
// The checklist half of §14.3.3 — and the "checklist gates submission, subtasks never do"
// proof — is PUL-405 Stage 2.
//
// Rig: the real easygrowcrm_test database, no DB mocks, no mocked `authorize()` (§15.8). The
// only stub is `auth.api.getSession`. Time is frozen through the clock port.

import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, projectTasks, taskSubtasks, user as userTable } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { addSubtask, toggleSubtask, deleteSubtask } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** pt_seed_2 — `in_progress`, assigned to employees[0]. The general-purpose subject. */
function empTask() {
  return seed.tasks[1].id;
}

function assignee() {
  return seed.employees[0];
}

async function subtasksOf(taskId: string) {
  return db
    .select()
    .from(taskSubtasks)
    .where(eq(taskSubtasks.taskId, taskId))
    .orderBy(asc(taskSubtasks.position));
}

async function subtaskRow(subtaskId: string) {
  const [row] = await db.select().from(taskSubtasks).where(eq(taskSubtasks.id, subtaskId));
  return row;
}

async function auditFor(taskId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, taskId));
}

/** Arrange a subtask directly, without an action (and so without an audit row). */
async function seedSubtask(taskId: string, overrides: { done?: boolean; position?: number } = {}) {
  const id = `ts_test_${crypto.randomUUID()}`;
  await db.insert(taskSubtasks).values({
    id,
    taskId,
    text: 'Draft the outline',
    done: overrides.done ?? false,
    position: overrides.position ?? 0,
    createdBy: assignee().id,
    createdAt: NOW,
  });
  return id;
}

async function submit(taskId: string) {
  await db.update(projectTasks).set({ status: 'submitted' }).where(eq(projectTasks.id, taskId));
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
// The assignee's happy path.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the assignee manages their own subtasks', () => {
  it('addSubtask inserts an undone row at position 0, created_by = actor, audited', async () => {
    actAs(assignee().id);

    const row = expectOk(await addSubtask({ taskId: empTask(), text: 'Keyword map' }));

    expect(row.id).toMatch(/^ts_/);
    expect(row).toMatchObject({
      taskId: empTask(),
      text: 'Keyword map',
      done: false,
      position: 0,
      createdBy: assignee().id,
    });
    expect(row.createdAt.toISOString()).toBe(NOW.toISOString());

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: assignee().id,
      action: 'project_task.subtask_added',
      resourceType: 'project_task',
      resourceId: empTask(),
      before: null,
    });
    expect(audit[0].after).toMatchObject({ id: row.id, text: 'Keyword map', done: false });

    // §13.4.9 lists no notification.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('position increments across adds (max + 1), so new subtasks land at the end', async () => {
    actAs(assignee().id);

    expectOk(await addSubtask({ taskId: empTask(), text: 'First' }));
    expectOk(await addSubtask({ taskId: empTask(), text: 'Second' }));

    const rows = await subtasksOf(empTask());
    expect(rows.map((r) => [r.text, r.position])).toEqual([
      ['First', 0],
      ['Second', 1],
    ]);
  });

  it('position follows the MAX, not the count — a gap left by a delete is not reused', async () => {
    await seedSubtask(empTask(), { position: 4 });
    actAs(assignee().id);

    const row = expectOk(await addSubtask({ taskId: empTask(), text: 'After the gap' }));
    expect(row.position).toBe(5);
  });

  it('toggleSubtask sets done and audits the before/after value', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(assignee().id);

    const row = expectOk(await toggleSubtask({ subtaskId, done: true }));
    expect(row.done).toBe(true);
    expect((await subtaskRow(subtaskId)).done).toBe(true);

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'project_task.subtask_toggled',
      resourceType: 'project_task',
      resourceId: empTask(),
      before: { subtaskId, done: false },
      after: { subtaskId, done: true },
    });
  });

  it('toggling back to false is a real change, audited again', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(assignee().id);

    expectOk(await toggleSubtask({ subtaskId, done: true }));
    expectOk(await toggleSubtask({ subtaskId, done: false }));

    expect((await subtaskRow(subtaskId)).done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(2);
  });

  it('toggling to the value the row already holds is a no-op: no UPDATE, no audit row', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(assignee().id);

    expectOk(await toggleSubtask({ subtaskId, done: true }));
    const again = expectOk(await toggleSubtask({ subtaskId, done: true }));

    expect(again.done).toBe(true);
    // Exactly the first toggle's row — the repeat wrote nothing.
    expect(await auditFor(empTask())).toHaveLength(1);
  });

  it('deleteSubtask hard-deletes the row and keeps it in the audit row\'s `before`', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(assignee().id);

    const removed = expectOk(await deleteSubtask({ subtaskId }));
    expect(removed.id).toBe(subtaskId);
    expect(await subtaskRow(subtaskId)).toBeUndefined();

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'project_task.subtask_removed',
      resourceType: 'project_task',
      resourceId: empTask(),
      after: null,
    });
    expect(audit[0].before).toMatchObject({ id: subtaskId, text: 'Draft the outline' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Who may (§9.6 project_task.subtask_manage).
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('who may manage subtasks (§9.6 ⁷)', () => {
  it('a MGR adds, toggles and removes on someone else\'s task', async () => {
    actAs(seed.projectManager.id);

    const added = expectOk(await addSubtask({ taskId: empTask(), text: 'Manager note' }));
    expect(added.createdBy).toBe(seed.projectManager.id);
    expectOk(await toggleSubtask({ subtaskId: added.id, done: true }));
    expectOk(await deleteSubtask({ subtaskId: added.id }));

    const actions = (await auditFor(empTask())).map((a) => a.action).sort();
    expect(actions).toEqual([
      'project_task.subtask_added',
      'project_task.subtask_removed',
      'project_task.subtask_toggled',
    ]);
  });

  it('a MGR may add to an UNASSIGNED task', async () => {
    actAs(seed.teamLeader.id);
    expectOk(await addSubtask({ taskId: seed.tasks[0].id, text: 'Scope it' }));
  });

  it('a non-assignee EMPLOYEE is refused on all three actions, and nothing is written', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(seed.employees[1].id);

    // FORBIDDEN from the §9.6 matrix: the conditional `assignee` cell refuses before the
    // transaction, and refuses without a reason — the same as `changeTaskStatusOpen`
    // (status-transitions.test.ts). The in-tx `not_assignee` re-check exists for the
    // reassigned-mid-flight race and is not reachable in the ordinary case.
    expectFail(await addSubtask({ taskId: empTask(), text: 'Nope' }), 'FORBIDDEN');
    expectFail(await toggleSubtask({ subtaskId, done: true }), 'FORBIDDEN');
    expectFail(await deleteSubtask({ subtaskId }), 'FORBIDDEN');

    const rows = await subtasksOf(empTask());
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('an employee cannot add to an UNASSIGNED task', async () => {
    actAs(assignee().id);
    expectFail(await addSubtask({ taskId: seed.tasks[0].id, text: 'Mine?' }), 'FORBIDDEN');
  });

  it('HR is denied — §9.6 ⁷ makes subtasks read-only for HR', async () => {
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    expectFail(await addSubtask({ taskId: empTask(), text: 'HR' }), 'FORBIDDEN');
    expect(await auditFor(empTask())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The post-submission lock (§14.3.3) — employee-only (§13.4.9).
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the submitted lock', () => {
  it('the ASSIGNEE is locked out of all three actions on a submitted task: GATE:locked', async () => {
    const subtaskId = await seedSubtask(empTask());
    await submit(empTask());
    actAs(assignee().id);

    expectFail(await addSubtask({ taskId: empTask(), text: 'Late' }), 'GATE', 'locked');
    expectFail(await toggleSubtask({ subtaskId, done: true }), 'GATE', 'locked');
    expectFail(await deleteSubtask({ subtaskId }), 'GATE', 'locked');

    const rows = await subtasksOf(empTask());
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('the same task unlocked (in_progress) lets the same assignee through — the lock is status', async () => {
    const subtaskId = await seedSubtask(empTask());
    actAs(assignee().id);

    expectOk(await toggleSubtask({ subtaskId, done: true }));
  });

  it('a MGR edits the SAME submitted task — the lock is employee-only (§13.4.9)', async () => {
    const subtaskId = await seedSubtask(empTask());
    await submit(empTask());
    actAs(seed.projectManager.id);

    expectOk(await addSubtask({ taskId: empTask(), text: 'Reviewer note' }));
    expectOk(await toggleSubtask({ subtaskId, done: true }));
    expectOk(await deleteSubtask({ subtaskId }));

    // Editing never re-opens the submission (§13.4.2): status is untouched.
    const [task] = await db.select().from(projectTasks).where(eq(projectTasks.id, empTask()));
    expect(task.status).toBe('submitted');
    expect(await auditFor(empTask())).toHaveLength(3);
  });

  it('the seeded submitted task (pt_seed_3, TL-assigned) is editable by its TL assignee', async () => {
    actAs(seed.teamLeader.id);
    expectOk(await addSubtask({ taskId: seed.tasks[2].id, text: 'TL is a manager' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// NOT_FOUND and validation.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('missing things', () => {
  it('addSubtask on a missing task is NOT_FOUND', async () => {
    actAs(seed.projectManager.id);
    expectFail(await addSubtask({ taskId: 'pt_does_not_exist', text: 'x' }), 'NOT_FOUND');
  });

  it('addSubtask on a soft-deleted task is NOT_FOUND', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, empTask()));
    actAs(seed.projectManager.id);
    expectFail(await addSubtask({ taskId: empTask(), text: 'x' }), 'NOT_FOUND');
  });

  it('toggle / delete on a missing subtask are NOT_FOUND', async () => {
    actAs(seed.projectManager.id);
    expectFail(await toggleSubtask({ subtaskId: 'ts_nope', done: true }), 'NOT_FOUND');
    expectFail(await deleteSubtask({ subtaskId: 'ts_nope' }), 'NOT_FOUND');
  });

  it('toggle / delete on a subtask whose task is soft-deleted are NOT_FOUND', async () => {
    const subtaskId = await seedSubtask(empTask());
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, empTask()));
    actAs(seed.projectManager.id);

    expectFail(await toggleSubtask({ subtaskId, done: true }), 'NOT_FOUND');
    expectFail(await deleteSubtask({ subtaskId }), 'NOT_FOUND');
    expect(await subtaskRow(subtaskId)).toBeDefined();
  });

  it('empty text fails at validation (a Zod rejection, per PUL-111) and writes nothing', async () => {
    actAs(assignee().id);
    await expect(addSubtask({ taskId: empTask(), text: '' })).rejects.toThrow();
    expect(await subtasksOf(empTask())).toHaveLength(0);
  });
});
