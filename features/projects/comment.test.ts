// features/projects/comment.test.ts
//
// PUL-406 — §13.4.11 `addComment`.
//
// Not a §15.4 mandatory file (the manifest is unchanged). The three properties that make this
// action unlike every other task write, each asserted directly:
//
//   1. the widest actor set — anyone with read access, non-assignee employees and HR included;
//   2. it NEVER locks on task status (§3.2.3) — only an archived project refuses it;
//   3. it writes NO audit row (§13.4.11 "Audit: none").
//
// Plus the `N:task_comment` audience: assignee + latest submitter + the reviewer who acted
// (latest review, else the latest submission's routing hint), deduped, author excluded.
//
// Rig: the real easygrowcrm_test database, no DB mocks, no mocked `authorize()` (§15.8). The
// only stub is `auth.api.getSession`. Time is frozen through the clock port.

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  auditLog,
  projectTasks,
  projects,
  taskComments,
  taskReviews,
  taskSubmissions,
  user as userTable,
} from '../../db/schema';
import { taskStatus } from '../../db/schema/enums';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { addComment } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** pt_seed_2 — `in_progress`, assigned to employees[0]. The general-purpose subject. */
function empTask() {
  return seed.tasks[1].id;
}

async function commentsOn(taskId: string) {
  return db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
}

async function auditCount() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  return n;
}

/** Recipients of `task_comment` sends, sorted, so set assertions ignore send order. */
function commentRecipients() {
  return __sentNotifications()
    .filter((n) => n.type === 'task_comment')
    .map((n) => n.to)
    .sort();
}

async function putTaskAt(taskId: string, status: (typeof taskStatus.enumValues)[number]) {
  await db.update(projectTasks).set({ status }).where(eq(projectTasks.id, taskId));
}

/** Arrange a submission row directly. `minutesAgo` orders several on the frozen clock. */
async function seedSubmission(
  taskId: string,
  opts: { submittedBy: string; reviewerId?: string | null; minutesAgo?: number },
) {
  const id = `sub_test_${crypto.randomUUID()}`;
  await db.insert(taskSubmissions).values({
    id,
    taskId,
    submittedBy: opts.submittedBy,
    summary: 'Done — see link',
    reviewerId: opts.reviewerId ?? null,
    createdAt: new Date(NOW.getTime() - (opts.minutesAgo ?? 0) * 60_000),
  });
  return id;
}

/** Arrange a review row directly (submitter copied from the submission, as §11.3.2 requires). */
async function seedReview(
  taskId: string,
  submissionId: string,
  opts: { reviewerId: string; submitterId: string; minutesAgo?: number },
) {
  await db.insert(taskReviews).values({
    id: `rev_test_${crypto.randomUUID()}`,
    submissionId,
    taskId,
    reviewerId: opts.reviewerId,
    submitterId: opts.submitterId,
    decision: 'revision_requested',
    note: 'Tighten the intro',
    createdAt: new Date(NOW.getTime() - (opts.minutesAgo ?? 0) * 60_000),
  });
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
// 1. The widest actor set.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('who may comment (§9.6 project_task.comment — every role)', () => {
  it('a plain NON-assignee employee comments: row written with them as author', async () => {
    actAs(seed.employees[1].id);

    const row = expectOk(await addComment({ taskId: empTask(), body: 'Is the brief final?' }));

    expect(row.id).toMatch(/^tcm_/);
    expect(row).toMatchObject({
      taskId: empTask(),
      authorId: seed.employees[1].id,
      body: 'Is the brief final?',
    });
    expect(row.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(await commentsOn(empTask())).toHaveLength(1);
  });

  it('HR comments too — the only task write HR may make', async () => {
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[2].id));
    actAs(seed.employees[2].id);

    expectOk(await addComment({ taskId: empTask(), body: 'HR note' }));
  });

  it('an employee may comment on an UNASSIGNED task', async () => {
    actAs(seed.employees[1].id);
    expectOk(await addComment({ taskId: seed.tasks[0].id, body: 'I can take this' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2. Never locks on status.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('comments never lock (§3.2.3)', () => {
  it('posts on the seeded SUBMITTED task (pt_seed_3), by a non-assignee employee', async () => {
    actAs(seed.employees[1].id);
    expectOk(await addComment({ taskId: seed.tasks[2].id, body: 'Question on the draft' }));
    expect(await commentsOn(seed.tasks[2].id)).toHaveLength(1);
  });

  // Every status, including all four locked/terminal ones. The assignee is used as the author
  // because it is exactly the actor every OTHER task write locks out while `submitted`.
  for (const status of taskStatus.enumValues) {
    it(`posts on a ${status} task, by its assignee`, async () => {
      await putTaskAt(empTask(), status);
      actAs(seed.employees[0].id);

      expectOk(await addComment({ taskId: empTask(), body: `On a ${status} task` }));
      expect(await commentsOn(empTask())).toHaveLength(1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3. No audit.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('no audit row (§13.4.11 "Audit: none")', () => {
  it('the audit_log count is unchanged across a successful comment', async () => {
    const before = await auditCount();
    actAs(seed.employees[0].id);

    expectOk(await addComment({ taskId: empTask(), body: 'Started on this' }));

    expect(await commentsOn(empTask())).toHaveLength(1);
    expect(await auditCount()).toBe(before);
  });

  it('…including on a submitted task, by a manager', async () => {
    await putTaskAt(empTask(), 'submitted');
    const before = await auditCount();
    actAs(seed.projectManager.id);

    expectOk(await addComment({ taskId: empTask(), body: 'Reviewing now' }));
    expect(await auditCount()).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The one refusal, and NOT_FOUND.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('refusals', () => {
  it('an archived project refuses comments: GATE:project_archived, nothing written', async () => {
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));
    actAs(seed.projectManager.id);

    expectFail(await addComment({ taskId: empTask(), body: 'x' }), 'GATE', 'project_archived');
    expect(await commentsOn(empTask())).toHaveLength(0);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('a missing task is NOT_FOUND', async () => {
    actAs(seed.projectManager.id);
    expectFail(await addComment({ taskId: 'pt_nope', body: 'x' }), 'NOT_FOUND');
  });

  it('a soft-deleted task is NOT_FOUND', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, empTask()));
    actAs(seed.projectManager.id);
    expectFail(await addComment({ taskId: empTask(), body: 'x' }), 'NOT_FOUND');
  });

  it('an empty body fails at validation (a Zod rejection, per PUL-111)', async () => {
    actAs(seed.projectManager.id);
    await expect(addComment({ taskId: empTask(), body: '' })).rejects.toThrow();
    expect(await commentsOn(empTask())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// N:task_comment — the audience.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('N:task_comment recipients', () => {
  it('reaches assignee + latest submitter + reviewer, and NOT the author', async () => {
    // Three distinct recipients: assignee e0; the submission was made by e1 (the task was
    // reassigned after submitting); reviewed by the TL. The author is e2, a bystander.
    const sub = await seedSubmission(empTask(), {
      submittedBy: seed.employees[1].id,
      reviewerId: seed.teamLeader.id,
    });
    await seedReview(empTask(), sub, {
      reviewerId: seed.teamLeader.id,
      submitterId: seed.employees[1].id,
    });
    actAs(seed.employees[2].id);

    const row = expectOk(await addComment({ taskId: empTask(), body: 'Looks close' }));

    expect(commentRecipients()).toEqual(
      [seed.employees[0].id, seed.employees[1].id, seed.teamLeader.id].sort(),
    );
    expect(commentRecipients()).not.toContain(seed.employees[2].id);

    const [first] = __sentNotifications();
    expect(first.data).toMatchObject({
      taskId: empTask(),
      commentId: row.id,
      authorId: seed.employees[2].id,
    });
  });

  it('when the author IS the assignee, they are excluded; only the others hear', async () => {
    const sub = await seedSubmission(empTask(), {
      submittedBy: seed.employees[0].id,
      reviewerId: seed.teamLeader.id,
    });
    await seedReview(empTask(), sub, {
      reviewerId: seed.teamLeader.id,
      submitterId: seed.employees[0].id,
    });
    actAs(seed.employees[0].id);

    expectOk(await addComment({ taskId: empTask(), body: 'Fixed the intro' }));

    // e0 is assignee AND submitter — excluded from both slots as the author.
    expect(commentRecipients()).toEqual([seed.teamLeader.id]);
  });

  it('a task with no assignee and no submissions notifies nobody', async () => {
    actAs(seed.projectManager.id);
    expectOk(await addComment({ taskId: seed.tasks[0].id, body: 'Scoping note' }));
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('a task with an assignee and no submissions notifies only the assignee', async () => {
    actAs(seed.projectManager.id);
    expectOk(await addComment({ taskId: empTask(), body: 'Priority bumped' }));
    expect(commentRecipients()).toEqual([seed.employees[0].id]);
  });

  it('no review yet → the latest submission\'s reviewer routing hint is notified', async () => {
    await seedSubmission(empTask(), {
      submittedBy: seed.employees[0].id,
      reviewerId: seed.projectManager.id,
    });
    actAs(seed.employees[1].id);

    expectOk(await addComment({ taskId: empTask(), body: 'FYI' }));
    expect(commentRecipients()).toEqual([seed.employees[0].id, seed.projectManager.id].sort());
  });

  it('a review beats the routing hint — the reviewer who ACTED is notified, not the hint', async () => {
    const sub = await seedSubmission(empTask(), {
      submittedBy: seed.employees[0].id,
      reviewerId: seed.projectManager.id,
    });
    await seedReview(empTask(), sub, {
      reviewerId: seed.teamLeader.id,
      submitterId: seed.employees[0].id,
    });
    actAs(seed.employees[1].id);

    expectOk(await addComment({ taskId: empTask(), body: 'FYI' }));
    expect(commentRecipients()).toEqual([seed.employees[0].id, seed.teamLeader.id].sort());
  });

  it('a resubmitted revision notifies the NEW round\'s reviewer, not the previous round\'s', async () => {
    // Round 1: submitted by the assignee, reviewed by R1 (TL) → revision requested.
    const round1 = await seedSubmission(empTask(), {
      submittedBy: seed.employees[0].id,
      reviewerId: seed.teamLeader.id,
      minutesAgo: 60,
    });
    await seedReview(empTask(), round1, {
      reviewerId: seed.teamLeader.id,
      submitterId: seed.employees[0].id,
      minutesAgo: 30,
    });
    // Round 2: resubmitted, routed to R2 (PM), NOT reviewed yet. The task's latest review is
    // still round 1's — the trap the scoping exists to avoid.
    await seedSubmission(empTask(), {
      submittedBy: seed.employees[0].id,
      reviewerId: seed.projectManager.id,
      minutesAgo: 5,
    });
    actAs(seed.employees[1].id);

    expectOk(await addComment({ taskId: empTask(), body: 'Second pass looks good' }));

    // Assignee (= submitter, deduped) + R2. Not R1.
    expect(commentRecipients()).toEqual([seed.employees[0].id, seed.projectManager.id].sort());
    expect(commentRecipients()).not.toContain(seed.teamLeader.id);
  });

  it('uses the LATEST submission, not the first', async () => {
    await seedSubmission(empTask(), { submittedBy: seed.employees[1].id, minutesAgo: 60 });
    await seedSubmission(empTask(), { submittedBy: seed.employees[2].id, minutesAgo: 5 });
    actAs(seed.projectManager.id);

    expectOk(await addComment({ taskId: empTask(), body: 'FYI' }));
    expect(commentRecipients()).toEqual([seed.employees[0].id, seed.employees[2].id].sort());
  });

  it('dedupes: assignee who is also the submitter is notified once', async () => {
    await seedSubmission(empTask(), { submittedBy: seed.employees[0].id });
    actAs(seed.projectManager.id);

    expectOk(await addComment({ taskId: empTask(), body: 'FYI' }));
    expect(commentRecipients()).toEqual([seed.employees[0].id]);
  });
});
