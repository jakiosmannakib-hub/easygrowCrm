// features/projects/checklist.test.ts
//
// PUL-405 Stage 2 — §13.4.10 `toggleChecklistItem` / `addChecklistItem` / `deleteChecklistItem`,
// plus the `checklistComplete` predicate PUL-601's `submitTask` will consume.
//
// Not a §15.4 mandatory file (the manifest is unchanged). The heart of it is the §9.6 ⁷ split:
// `checklist_toggle` (assignee or MGR — employees COMPLETE the definition-of-done) versus
// `checklist_manage` (MGR only — managers DEFINE it). Also: the EMP-only submitted lock on
// toggles, the absence of that lock on manager add/delete (no retro-gate), and the archived
// project guard.
//
// Rig: the real easygrowcrm_test database, no DB mocks, no mocked `authorize()` (§15.8). The
// only stub is `auth.api.getSession`. Time is frozen through the clock port.

import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  auditLog,
  projectTasks,
  projects,
  taskChecklistItems,
  taskSubtasks,
} from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';
import { checklistComplete } from './queries';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { toggleChecklistItem, addChecklistItem, deleteChecklistItem } = await import('./actions');

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

async function itemsOf(taskId: string) {
  return db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.position));
}

async function itemRow(itemId: string) {
  const [row] = await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.id, itemId));
  return row;
}

async function taskRow(taskId: string) {
  const [row] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
  return row;
}

async function auditFor(taskId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, taskId));
}

/** Arrange a checklist item directly, without an action (and so without an audit row). */
async function seedItem(taskId: string, overrides: { done?: boolean; position?: number } = {}) {
  const id = `tci_test_${crypto.randomUUID()}`;
  await db.insert(taskChecklistItems).values({
    id,
    taskId,
    text: 'Meta description written',
    done: overrides.done ?? false,
    position: overrides.position ?? 0,
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
// toggleChecklistItem — `checklist_toggle`: assignee or MGR.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('toggleChecklistItem (§13.4.10, checklist_toggle)', () => {
  it('the assignee ticks an item: row updated, checklist_toggled audited', async () => {
    const itemId = await seedItem(empTask());
    actAs(assignee().id);

    const row = expectOk(await toggleChecklistItem({ itemId, done: true }));
    expect(row.done).toBe(true);
    expect((await itemRow(itemId)).done).toBe(true);

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: assignee().id,
      action: 'project_task.checklist_toggled',
      resourceType: 'project_task',
      resourceId: empTask(),
      before: { itemId, done: false },
      after: { itemId, done: true },
    });

    // §13.4.10 lists no notification.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('a MGR ticks an item on someone else\'s task', async () => {
    const itemId = await seedItem(empTask());
    actAs(seed.projectManager.id);

    expectOk(await toggleChecklistItem({ itemId, done: true }));
    expect((await itemRow(itemId)).done).toBe(true);

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'project_task.checklist_toggled',
    });
  });

  it('toggling to the value the row already holds is a no-op: no audit row', async () => {
    const itemId = await seedItem(empTask(), { done: true });
    actAs(assignee().id);

    const row = expectOk(await toggleChecklistItem({ itemId, done: true }));
    expect(row.done).toBe(true);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('a non-assignee EMPLOYEE is refused (FORBIDDEN), and nothing is written', async () => {
    const itemId = await seedItem(empTask());
    actAs(seed.employees[1].id);

    expectFail(await toggleChecklistItem({ itemId, done: true }), 'FORBIDDEN');

    expect((await itemRow(itemId)).done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('the assignee is locked out on a SUBMITTED task: GATE:locked', async () => {
    const itemId = await seedItem(empTask());
    await submit(empTask());
    actAs(assignee().id);

    expectFail(await toggleChecklistItem({ itemId, done: true }), 'GATE', 'locked');

    expect((await itemRow(itemId)).done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('a MGR toggles on the SAME submitted task — the lock is employee-only', async () => {
    const itemId = await seedItem(empTask());
    await submit(empTask());
    actAs(seed.projectManager.id);

    expectOk(await toggleChecklistItem({ itemId, done: true }));
    expect((await taskRow(empTask())).status).toBe('submitted');
  });

  it('NOT_FOUND on a missing item, and on an item whose task is soft-deleted', async () => {
    const itemId = await seedItem(empTask());
    actAs(seed.projectManager.id);

    expectFail(await toggleChecklistItem({ itemId: 'tci_nope', done: true }), 'NOT_FOUND');

    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, empTask()));
    expectFail(await toggleChecklistItem({ itemId, done: true }), 'NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// add / delete — `checklist_manage`: MGR only.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('addChecklistItem / deleteChecklistItem (§13.4.10, checklist_manage)', () => {
  it('a MGR adds an item: undone, position max + 1, checklist_edited audited', async () => {
    await seedItem(empTask(), { position: 0 });
    actAs(seed.teamLeader.id);

    const row = expectOk(await addChecklistItem({ taskId: empTask(), text: 'Alt text on images' }));
    expect(row.id).toMatch(/^tci_/);
    expect(row).toMatchObject({ taskId: empTask(), text: 'Alt text on images', done: false, position: 1 });

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.teamLeader.id,
      action: 'project_task.checklist_edited',
      resourceType: 'project_task',
      resourceId: empTask(),
      before: null,
    });
    expect(audit[0].after).toMatchObject({ id: row.id, text: 'Alt text on images' });
  });

  it('the first item on a task gets position 0', async () => {
    actAs(seed.teamLeader.id);
    const row = expectOk(await addChecklistItem({ taskId: empTask(), text: 'First' }));
    expect(row.position).toBe(0);
  });

  it('a MGR deletes an item: row gone, checklist_edited audited with the row in `before`', async () => {
    const itemId = await seedItem(empTask());
    actAs(seed.projectManager.id);

    const removed = expectOk(await deleteChecklistItem({ itemId }));
    expect(removed.id).toBe(itemId);
    expect(await itemRow(itemId)).toBeUndefined();

    const audit = await auditFor(empTask());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'project_task.checklist_edited',
      resourceId: empTask(),
      after: null,
    });
    expect(audit[0].before).toMatchObject({ id: itemId, text: 'Meta description written' });
  });

  it('the ASSIGNEE is refused add AND delete — they complete the checklist, not define it', async () => {
    const itemId = await seedItem(empTask());
    actAs(assignee().id);

    expectFail(await addChecklistItem({ taskId: empTask(), text: 'My own bar' }), 'FORBIDDEN');
    expectFail(await deleteChecklistItem({ itemId }), 'FORBIDDEN');

    expect(await itemsOf(empTask())).toHaveLength(1);
    expect(await auditFor(empTask())).toHaveLength(0);
  });

  it('a non-assignee employee is refused add and delete too', async () => {
    const itemId = await seedItem(empTask());
    actAs(seed.employees[1].id);

    expectFail(await addChecklistItem({ taskId: empTask(), text: 'x' }), 'FORBIDDEN');
    expectFail(await deleteChecklistItem({ itemId }), 'FORBIDDEN');
  });

  it('a MGR adds to a SUBMITTED task: allowed, and the task\'s status + version are untouched', async () => {
    await submit(empTask());
    const before = await taskRow(empTask());
    actAs(seed.projectManager.id);

    expectOk(await addChecklistItem({ taskId: empTask(), text: 'Added mid-review' }));

    // No retro-gate (§13.4.10): the pending submission stands; nothing about the task row moved.
    const after = await taskRow(empTask());
    expect(after.status).toBe('submitted');
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  it('a MGR deletes from a SUBMITTED task: allowed, task untouched', async () => {
    const itemId = await seedItem(empTask());
    await submit(empTask());
    const before = await taskRow(empTask());
    actAs(seed.projectManager.id);

    expectOk(await deleteChecklistItem({ itemId }));
    expect((await taskRow(empTask())).version).toBe(before.version);
  });

  it('NOT_FOUND: add to a missing task, delete a missing item', async () => {
    actAs(seed.projectManager.id);
    expectFail(await addChecklistItem({ taskId: 'pt_nope', text: 'x' }), 'NOT_FOUND');
    expectFail(await deleteChecklistItem({ itemId: 'tci_nope' }), 'NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Archived project — read-only for every role (§13.3.4).
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('archived project', () => {
  it('toggle, add and delete are all refused with GATE:project_archived', async () => {
    const itemId = await seedItem(empTask());
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));

    actAs(assignee().id);
    expectFail(await toggleChecklistItem({ itemId, done: true }), 'GATE', 'project_archived');

    actAs(seed.projectManager.id);
    expectFail(await toggleChecklistItem({ itemId, done: true }), 'GATE', 'project_archived');
    expectFail(await addChecklistItem({ taskId: empTask(), text: 'x' }), 'GATE', 'project_archived');
    expectFail(await deleteChecklistItem({ itemId }), 'GATE', 'project_archived');

    const items = await itemsOf(empTask());
    expect(items).toHaveLength(1);
    expect(items[0].done).toBe(false);
    expect(await auditFor(empTask())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// checklistComplete — the predicate PUL-601's submit gate will consume.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('checklistComplete (queries.ts)', () => {
  it('is TRUE when the task has no checklist items at all', async () => {
    expect(await checklistComplete(db, empTask())).toBe(true);
  });

  it('is FALSE while any item is unchecked', async () => {
    await seedItem(empTask(), { done: true, position: 0 });
    await seedItem(empTask(), { done: false, position: 1 });
    expect(await checklistComplete(db, empTask())).toBe(false);
  });

  it('is TRUE once every item is checked', async () => {
    await seedItem(empTask(), { done: true, position: 0 });
    await seedItem(empTask(), { done: true, position: 1 });
    expect(await checklistComplete(db, empTask())).toBe(true);
  });

  it('only reads its own task — an unchecked item elsewhere does not leak in', async () => {
    await seedItem(seed.tasks[0].id, { done: false });
    expect(await checklistComplete(db, empTask())).toBe(true);
  });

  it('ignores subtasks entirely — they never gate (§9.6 ⁷, §16.8)', async () => {
    await seedItem(empTask(), { done: true });
    await db.insert(taskSubtasks).values({
      id: 'ts_test_unchecked',
      taskId: empTask(),
      text: 'Unfinished breakdown',
      done: false,
      position: 0,
      createdBy: assignee().id,
      createdAt: NOW,
    });
    expect(await checklistComplete(db, empTask())).toBe(true);
  });

  it('flips with the toggle action — the action and the predicate agree', async () => {
    const itemId = await seedItem(empTask());
    actAs(assignee().id);

    expect(await checklistComplete(db, empTask())).toBe(false);
    expectOk(await toggleChecklistItem({ itemId, done: true }));
    expect(await checklistComplete(db, empTask())).toBe(true);
  });
});
