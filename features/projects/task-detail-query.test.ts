// features/projects/task-detail-query.test.ts
//
// PUL-407 Stage 1 — §13.8 `getTaskDetail`, the aggregate the Task Detail modal (§14.3.3) reads.
//
// Not a §15.4 mandatory file (the manifest is unchanged). Asserts the aggregate's shape and its
// orderings: children by position, comments oldest-first with authors resolved, submissions
// newest-first each carrying its review, checklist counts, assignee, and the display-only
// dependency. Plus the session requirement and `null` for a missing / soft-deleted task.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The only stub is
// `auth.api.getSession`. Children, comments and QC rows are arranged by raw insert, with
// timestamps derived from the frozen clock — Phase 6's submit/review actions do not exist yet.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  projectTasks,
  taskChecklistItems,
  taskComments,
  taskReviews,
  taskSubmissions,
  taskSubtasks,
  user as userTable,
} from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getTaskDetail } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

function minutesAgo(n: number) {
  return new Date(NOW.getTime() - n * 60_000);
}

/** pt_seed_2 — `in_progress`, assigned to employees[0]. The subject throughout. */
function subject() {
  return seed.tasks[1].id;
}

beforeEach(async () => {
  seed = await seedMinimal();
  setClock(createTestClock(NOW));
  actAs(seed.employees[1].id); // a plain non-assignee employee: the read is open to every role
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('getTaskDetail — the aggregate', () => {
  it('returns the task row, project · client breadcrumb and resolved assignee', async () => {
    await db
      .update(projectTasks)
      .set({
        dueDate: '2026-09-20',
        estimatedHours: '1.50',
        actualHours: '0.75',
        description: 'Write the pillar page',
        sopUrl: 'https://sop.example/pillar',
        expectedOutput: 'A 2,000-word draft',
        revisionNote: null,
      })
      .where(eq(projectTasks.id, subject()));
    await db
      .update(userTable)
      .set({ image: 'https://img.example/e1.png' })
      .where(eq(userTable.id, seed.employees[0].id));

    const detail = await getTaskDetail(subject());

    expect(detail).not.toBeNull();
    expect(detail!.task).toMatchObject({
      id: subject(),
      title: 'Seed Task In Progress',
      status: 'in_progress',
      priority: 'medium',
      version: 1,
      dueDate: '2026-09-20',
      estimatedHours: 1.5,
      actualHours: 0.75,
      qcRequired: true,
      proofRequired: false,
      description: 'Write the pillar page',
      sopUrl: 'https://sop.example/pillar',
      expectedOutput: 'A 2,000-word draft',
      revisionNote: null,
      category: 'Content',
      month: 1,
      assigneeId: seed.employees[0].id,
      dependsOn: null,
    });
    expect(detail!.project).toEqual({ id: seed.project.id, name: seed.project.name, status: 'active' });
    expect(detail!.client).toEqual({ name: seed.client.name });
    expect(detail!.assignee).toEqual({
      id: seed.employees[0].id,
      name: seed.employees[0].name,
      image: 'https://img.example/e1.png',
    });
  });

  it('an unassigned task has assignee null; a bare task has empty collections and 0/0', async () => {
    const detail = await getTaskDetail(seed.tasks[0].id);

    expect(detail!.assignee).toBeNull();
    expect(detail!.task.estimatedHours).toBeNull();
    expect(detail!.subtasks).toEqual([]);
    expect(detail!.checklist).toEqual([]);
    expect(detail!.checklistDone).toBe(0);
    expect(detail!.checklistTotal).toBe(0);
    expect(detail!.comments).toEqual([]);
    expect(detail!.submissions).toEqual([]);
    expect(detail!.dependency).toBeNull();
  });

  it('subtasks come back ordered by position ASC, not insertion order', async () => {
    await db.insert(taskSubtasks).values([
      { id: 'ts_c', taskId: subject(), text: 'third', done: false, position: 2, createdBy: seed.employees[0].id },
      { id: 'ts_a', taskId: subject(), text: 'first', done: true, position: 0, createdBy: seed.employees[0].id },
      { id: 'ts_b', taskId: subject(), text: 'second', done: false, position: 1, createdBy: seed.employees[0].id },
    ]);

    const detail = await getTaskDetail(subject());

    expect(detail!.subtasks).toEqual([
      { id: 'ts_a', text: 'first', done: true },
      { id: 'ts_b', text: 'second', done: false },
      { id: 'ts_c', text: 'third', done: false },
    ]);
  });

  it('checklist ordered by position ASC, with checklistDone / checklistTotal computed (3/5)', async () => {
    await db.insert(taskChecklistItems).values([
      { id: 'tci_5', taskId: subject(), text: 'five', done: false, position: 4 },
      { id: 'tci_2', taskId: subject(), text: 'two', done: true, position: 1 },
      { id: 'tci_4', taskId: subject(), text: 'four', done: true, position: 3 },
      { id: 'tci_1', taskId: subject(), text: 'one', done: true, position: 0 },
      { id: 'tci_3', taskId: subject(), text: 'three', done: false, position: 2 },
    ]);

    const detail = await getTaskDetail(subject());

    expect(detail!.checklist.map((c) => c.id)).toEqual(['tci_1', 'tci_2', 'tci_3', 'tci_4', 'tci_5']);
    expect(detail!.checklist[2]).toEqual({ id: 'tci_3', text: 'three', done: false });
    expect(detail!.checklistDone).toBe(3);
    expect(detail!.checklistTotal).toBe(5);
  });

  it('checklist counts ignore subtasks entirely (subtasks never gate, §9.6 ⁷)', async () => {
    await db.insert(taskChecklistItems).values([
      { id: 'tci_1', taskId: subject(), text: 'one', done: true, position: 0 },
    ]);
    await db.insert(taskSubtasks).values([
      { id: 'ts_a', taskId: subject(), text: 'open subtask', done: false, position: 0, createdBy: seed.employees[0].id },
    ]);

    const detail = await getTaskDetail(subject());

    expect(detail!.checklistDone).toBe(1);
    expect(detail!.checklistTotal).toBe(1);
  });

  it('comments come back oldest first, each with its author resolved', async () => {
    await db
      .update(userTable)
      .set({ image: 'https://img.example/pm.png' })
      .where(eq(userTable.id, seed.projectManager.id));
    await db.insert(taskComments).values([
      { id: 'tcm_late', taskId: subject(), authorId: seed.employees[0].id, body: 'Draft is up', createdAt: minutesAgo(5) },
      { id: 'tcm_early', taskId: subject(), authorId: seed.projectManager.id, body: 'Brief attached', createdAt: minutesAgo(60) },
      { id: 'tcm_mid', taskId: subject(), authorId: seed.employees[1].id, body: 'Is it final?', createdAt: minutesAgo(30) },
    ]);

    const detail = await getTaskDetail(subject());

    expect(detail!.comments.map((c) => c.id)).toEqual(['tcm_early', 'tcm_mid', 'tcm_late']);
    expect(detail!.comments[0]).toEqual({
      id: 'tcm_early',
      body: 'Brief attached',
      createdAt: minutesAgo(60),
      author: { id: seed.projectManager.id, name: seed.projectManager.name, image: 'https://img.example/pm.png' },
    });
    expect(detail!.comments[1].author).toEqual({
      id: seed.employees[1].id,
      name: seed.employees[1].name,
      image: null,
    });
  });

  it('submissions come back newest first; a reviewed one carries its review, a pending one null', async () => {
    await db.insert(taskSubmissions).values([
      {
        id: 'sub_1',
        taskId: subject(),
        submittedBy: seed.employees[0].id,
        summary: 'First pass',
        hours: '1.50',
        issues: 'Client slow on assets',
        proofType: 'google_doc',
        proofValue: 'https://docs.example/v1',
        reviewerId: seed.teamLeader.id,
        createdAt: minutesAgo(120),
      },
      {
        id: 'sub_2',
        taskId: subject(),
        submittedBy: seed.employees[0].id,
        summary: 'Revised',
        hours: null,
        reviewerId: seed.projectManager.id,
        createdAt: minutesAgo(10),
      },
    ]);
    await db.insert(taskReviews).values({
      id: 'rev_1',
      submissionId: 'sub_1',
      taskId: subject(),
      reviewerId: seed.teamLeader.id,
      submitterId: seed.employees[0].id,
      decision: 'revision_requested',
      note: 'Tighten the intro',
      rating: 3,
      metaRating: 4,
      metaBy: seed.projectManager.id,
      metaAt: minutesAgo(30),
      createdAt: minutesAgo(60),
    });

    const detail = await getTaskDetail(subject());

    expect(detail!.submissions.map((s) => s.id)).toEqual(['sub_2', 'sub_1']);
    expect(detail!.submissions[0]).toEqual({
      id: 'sub_2',
      summary: 'Revised',
      hours: null,
      issues: null,
      proofType: null,
      proofValue: null,
      submittedBy: { name: seed.employees[0].name },
      createdAt: minutesAgo(10),
      review: null,
    });
    expect(detail!.submissions[1]).toEqual({
      id: 'sub_1',
      summary: 'First pass',
      hours: 1.5,
      issues: 'Client slow on assets',
      proofType: 'google_doc',
      proofValue: 'https://docs.example/v1',
      submittedBy: { name: seed.employees[0].name },
      createdAt: minutesAgo(120),
      review: {
        decision: 'revision_requested',
        reviewer: { name: seed.teamLeader.name },
        note: 'Tighten the intro',
        rating: 3,
        metaRating: 4,
      },
    });
  });

  it('dependency carries the upstream task { id, title, status } — and the read writes nothing', async () => {
    await db
      .update(projectTasks)
      .set({ dependsOn: seed.tasks[2].id })
      .where(eq(projectTasks.id, subject()));

    const detail = await getTaskDetail(subject());

    expect(detail!.task.dependsOn).toBe(seed.tasks[2].id);
    expect(detail!.dependency).toEqual({
      id: seed.tasks[2].id,
      title: 'Seed Task Submitted',
      status: 'submitted',
    });

    // Display only (§3.2.5): the blocked lock is never persisted by the read.
    const [after] = await db
      .select({ status: projectTasks.status, version: projectTasks.version })
      .from(projectTasks)
      .where(eq(projectTasks.id, subject()));
    expect(after).toEqual({ status: 'in_progress', version: 1 });
  });

  it('only reads its own task: another task’s children do not leak in', async () => {
    await db.insert(taskChecklistItems).values([
      { id: 'tci_other', taskId: seed.tasks[0].id, text: 'not mine', done: true, position: 0 },
    ]);
    await db.insert(taskComments).values([
      { id: 'tcm_other', taskId: seed.tasks[0].id, authorId: seed.employees[0].id, body: 'elsewhere', createdAt: NOW },
    ]);

    const detail = await getTaskDetail(subject());

    expect(detail!.checklist).toEqual([]);
    expect(detail!.checklistTotal).toBe(0);
    expect(detail!.comments).toEqual([]);
  });
});

describe('getTaskDetail — not found and access', () => {
  it('returns null for a task id that does not exist', async () => {
    expect(await getTaskDetail('pt_does_not_exist')).toBeNull();
  });

  it('returns null for a soft-deleted task', async () => {
    await db
      .update(projectTasks)
      .set({ deletedAt: minutesAgo(1) })
      .where(eq(projectTasks.id, subject()));

    expect(await getTaskDetail(subject())).toBeNull();
  });

  it('is open to every role — HR reads the same aggregate (no per-role deny)', async () => {
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[2].id));
    actAs(seed.employees[2].id);

    expect((await getTaskDetail(subject()))?.task.id).toBe(subject());
  });

  it('rejects an unauthenticated caller (UNAUTHENTICATED)', async () => {
    getSession.mockResolvedValue(null);

    await expect(getTaskDetail(subject())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a deactivated caller (DEACTIVATED), re-read from the DB', async () => {
    await db
      .update(userTable)
      .set({ active: false })
      .where(eq(userTable.id, seed.employees[1].id));

    await expect(getTaskDetail(subject())).rejects.toMatchObject({ code: 'DEACTIVATED' });
  });
});
