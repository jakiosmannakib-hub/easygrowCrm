// features/projects/status-transitions.test.ts
//
// §15.4 MANDATORY test — "all legal + all illegal transitions per role" (PUL-404.6), and the
// contract test for §13.4.4 `changeTaskStatusOpen`.
//
// ── SCOPE ────────────────────────────────────────────────────────────────────────────────
// This file spans BOTH halves of the task status matrix, each enumerated origin × target:
//
//   §13.4.4 `changeTaskStatusOpen`      — 8 origins × 3 pill statuses   (PUL-404 Stage 1)
//   §13.4.5 `setTaskStatusProtected`    — 8 origins × 4 override statuses (PUL-404 Stage 2)
//
// plus the per-role reachability of each, the shared optimistic lock, and the two gates that
// only exist on the protected path (`use_review`, `note_required`).
//
// STILL OWED: §13.4.6 `submitTask` is the third and last way a task's status moves, and it is
// not built yet (its own ticket). When it lands, its transitions belong HERE rather than in a
// new file — the point of a matrix test is that one file answers "can X move from A to B?".
//
// Rig: the real easygrowcrm_test database, no DB mocks, no mocked `authorize()` (§15.8) — the
// role matrix is a thing under contract here, so mocking it would test nothing. The only stub
// is `auth.api.getSession`. Time is frozen through the clock port.

import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, projectTasks, user as userTable } from '../../db/schema';
import { taskStatus } from '../../db/schema/enums';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { changeTaskStatusOpen, setTaskStatusProtected } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');

/** §13.4.4's settable values — what the pill can ask for. */
const SETTABLE = ['planned', 'in_progress', 'blocked'] as const;

/** §13.4.4's exitable values — what a task may be moved OUT of here. */
const OPEN = ['planned', 'in_progress', 'blocked', 'revision_required'] as const;

/** §13.4.5's settable values — the manager overrides. */
const PROTECTED = ['approved', 'completed', 'cancelled', 'revision_required'] as const;

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function taskRow(taskId: string) {
  const [row] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
  return row;
}

async function auditFor(taskId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, taskId));
}

/** Force a task into an arbitrary starting state without going through an action. */
async function putTaskAt(
  taskId: string,
  state: { status: (typeof taskStatus.enumValues)[number]; assigneeId?: string | null },
) {
  await db
    .update(projectTasks)
    .set({
      status: state.status,
      ...(state.assigneeId !== undefined && { assigneeId: state.assigneeId }),
    })
    .where(eq(projectTasks.id, taskId));
}

/** The seeded planned/unassigned task — the general-purpose subject. */
function subject() {
  return seed.tasks[0].id;
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
  __resetNotifications();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The matrix: every origin status × every settable status.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the open-status transition matrix (§13.4.4)', () => {
  for (const from of taskStatus.enumValues) {
    for (const to of SETTABLE) {
      const exitable = (OPEN as readonly string[]).includes(from);
      const verdict = exitable ? (from === to ? 'no-op' : 'allowed') : 'GATE:locked';

      it(`${from} → ${to} is ${verdict}`, async () => {
        await putTaskAt(subject(), { status: from });
        actAs(seed.projectManager.id);

        const before = await taskRow(subject());
        const result = await changeTaskStatusOpen({
          taskId: subject(),
          version: before.version,
          status: to,
        });

        if (!exitable) {
          expectFail(result, 'GATE', 'locked');
          // A refused transition leaves the row exactly as it was.
          expect((await taskRow(subject())).status).toBe(from);
          expect(await auditFor(subject())).toHaveLength(0);
          return;
        }

        const row = expectOk(result);
        expect(row.status).toBe(to);

        const stored = await taskRow(subject());
        expect(stored.status).toBe(to);

        if (from === to) {
          // No-op: nothing moved, so nothing was written.
          expect(stored.version).toBe(before.version);
          expect(await auditFor(subject())).toHaveLength(0);
        } else {
          expect(stored.version).toBe(before.version + 1);
          expect(await auditFor(subject())).toHaveLength(1);
        }
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Per-role reachability.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('who may move a task (§9.6 project_task.set_status_open)', () => {
  it('MGR moves planned → in_progress: status set, version bumped, audit written', async () => {
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());
    expect(before.status).toBe('planned');
    expect(before.version).toBe(1);

    const row = expectOk(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }),
    );

    expect(row).toMatchObject({ status: 'in_progress', version: 2 });

    const stored = await taskRow(subject());
    expect(stored.status).toBe('in_progress');
    expect(stored.version).toBe(2);
    expect(stored.updatedAt.toISOString()).toBe(NOW.toISOString());

    const audit = await auditFor(subject());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'project_task.status_changed',
      resourceType: 'project_task',
      before: { status: 'planned', version: 1 },
      after: { status: 'in_progress', version: 2 },
    });

    // §13.4.4 lists no notification — a self-driven pill change tells nobody.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('an EMPLOYEE who IS the assignee may move their own task', async () => {
    // The conditional `assignee` cell: this is the case that would break if `authorize` were
    // called without the subject resource, since `can()` fails a conditional cell closed.
    const task = seed.tasks[1].id; // seeded in_progress, assigned to employees[0]
    actAs(seed.employees[0].id);

    const before = await taskRow(task);
    expect(before.assigneeId).toBe(seed.employees[0].id);

    const row = expectOk(
      await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'blocked' }),
    );

    expect(row.status).toBe('blocked');
    expect((await taskRow(task)).status).toBe('blocked');
  });

  it('an EMPLOYEE who is NOT the assignee is refused, and writes nothing', async () => {
    const task = seed.tasks[1].id; // assigned to employees[0]
    actAs(seed.employees[1].id);

    const before = await taskRow(task);

    // FORBIDDEN, from the §9.6 matrix: the conditional `assignee` cell compares the row's
    // assignee to the caller and fails. (The action ALSO re-checks ownership inside the
    // transaction with `reason: 'not_assignee'`, but that guard exists for the reassigned-
    // mid-flight race — in the ordinary case the matrix refuses first, and it refuses without
    // a reason because `errorToToast` gives every FORBIDDEN fixed wording by design.)
    expectFail(await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'planned' }), 'FORBIDDEN');

    expect((await taskRow(task)).status).toBe(before.status);
    expect((await taskRow(task)).version).toBe(before.version);
    expect(await auditFor(task)).toHaveLength(0);
  });

  it('an employee cannot move an UNASSIGNED task', async () => {
    // `subject()` is unassigned, so the conditional cell has nothing to match against.
    actAs(seed.employees[0].id);

    expectFail(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }),
      'FORBIDDEN',
    );
  });

  it('HR is denied — §9.6 gives admin_hr no status permission at all', async () => {
    // The fixture has no HR user; promote a seeded employee so the role comes from a real row.
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.employees[0].id);

    expectFail(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }),
      'FORBIDDEN',
    );

    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('MUTATION PROOF: the employee deny is the matrix, not an accident of the fixture', async () => {
    // Same caller, same payload, one role flipped to a manager role. If the FORBIDDEN above
    // came from anywhere but §9.6, this would fail too.
    const task = seed.tasks[1].id;
    await db
      .update(userTable)
      .set({ role: 'team_leader' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    const before = await taskRow(task);
    const row = expectOk(
      await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'planned' }),
    );

    expect(row.status).toBe('planned');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The optimistic lock — the pattern this action establishes.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the optimistic lock (§13.4.4 version)', () => {
  it('a stale version is a CONFLICT, and the failed call changes nothing', async () => {
    actAs(seed.projectManager.id);

    // The client read the row at version 1...
    const staleVersion = (await taskRow(subject())).version;
    expect(staleVersion).toBe(1);

    // ...and someone else wrote in the meantime, moving it to 2.
    await db
      .update(projectTasks)
      .set({ version: staleVersion + 1 })
      .where(eq(projectTasks.id, subject()));

    const failure = expectFail(
      await changeTaskStatusOpen({
        taskId: subject(),
        version: staleVersion,
        status: 'in_progress',
      }),
      'CONFLICT',
      'stale_version',
    );

    expect(failure.details).toMatchObject({ expectedVersion: 1, actualVersion: 2 });

    // The losing writer applied NOTHING: status untouched, version untouched, no audit row.
    const after = await taskRow(subject());
    expect(after.status).toBe('planned');
    expect(after.version).toBe(2);
    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('the fresh version succeeds where the stale one failed', async () => {
    // Pins that the CONFLICT above is about the VERSION and nothing else: identical call,
    // identical row, only the version corrected.
    actAs(seed.projectManager.id);

    await db.update(projectTasks).set({ version: 2 }).where(eq(projectTasks.id, subject()));

    expectFail(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }),
      'CONFLICT',
      'stale_version',
    );

    const row = expectOk(
      await changeTaskStatusOpen({ taskId: subject(), version: 2, status: 'in_progress' }),
    );

    expect(row).toMatchObject({ status: 'in_progress', version: 3 });
  });

  it('a no-op does NOT consult the version — nothing can lose a race it never entered', async () => {
    actAs(seed.projectManager.id);

    await db.update(projectTasks).set({ version: 7 }).where(eq(projectTasks.id, subject()));

    // Same status as stored, deliberately stale version: still ok, because nothing changes.
    const row = expectOk(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'planned' }),
    );

    expect(row.status).toBe('planned');
    expect((await taskRow(subject())).version).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Remaining §13.4.4 behaviour.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('changeTaskStatusOpen — the rest of the contract', () => {
  it('revision_required → in_progress is allowed (the back-to-work path)', async () => {
    const task = seed.extraTasks[1].id; // seeded revision_required
    actAs(seed.projectManager.id);

    const before = await taskRow(task);
    expect(before.status).toBe('revision_required');

    const row = expectOk(
      await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'in_progress' }),
    );

    expect(row.status).toBe('in_progress');
  });

  it('the assignee can take their own revision_required task back to work', async () => {
    const task = seed.extraTasks[1].id; // assigned to employees[2]
    actAs(seed.employees[2].id);

    const before = await taskRow(task);
    const row = expectOk(
      await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'in_progress' }),
    );

    expect(row.status).toBe('in_progress');
  });

  it('a submitted task is locked: GATE:locked, naming the status', async () => {
    const task = seed.tasks[2].id; // seeded submitted
    actAs(seed.projectManager.id);

    const before = await taskRow(task);
    const failure = expectFail(
      await changeTaskStatusOpen({ taskId: task, version: before.version, status: 'in_progress' }),
      'GATE',
      'locked',
    );

    expect(failure.details).toMatchObject({ status: 'submitted' });
    expect((await taskRow(task)).status).toBe('submitted');
  });

  it('same status is a no-op: no version bump, no audit row, updated_at unmoved', async () => {
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());

    const row = expectOk(
      await changeTaskStatusOpen({ taskId: subject(), version: before.version, status: 'planned' }),
    );

    expect(row.status).toBe('planned');

    const after = await taskRow(subject());
    expect(after.version).toBe(before.version);
    expect(await auditFor(subject())).toHaveLength(0);
    // seedFull wrote `updated_at` at the wall clock; a real UPDATE would move it to the frozen
    // NOW. Unmoved proves no UPDATE ran, rather than merely that the status still matches.
    expect(after.updatedAt.toISOString()).not.toBe(NOW.toISOString());
  });

  it('rejects a missing task with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(
      await changeTaskStatusOpen({
        taskId: 'pt_does_not_exist',
        version: 1,
        status: 'in_progress',
      }),
      'NOT_FOUND',
    );
  });

  it('rejects a soft-deleted task with NOT_FOUND', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, subject()));
    actAs(seed.projectManager.id);

    expectFail(
      await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }),
      'NOT_FOUND',
    );
  });

  it('a malformed version fails at validation, not as a CONFLICT', async () => {
    // §11.3 starts every row at 1, so version 0 is a broken client, not a stale one — and it
    // must not reach the lock, because telling that user to "refresh" would never help.
    //
    // It REJECTS rather than returning `{ ok: false }`: `actionResult` converts `AppError`
    // only, and a Zod failure is a caller bug, not one of the seven §13 outcomes. That is
    // PUL-111's deliberate design, pinned in features/employees/action-result-boundary.test.ts.
    actAs(seed.projectManager.id);

    await expect(
      changeTaskStatusOpen({ taskId: subject(), version: 0, status: 'in_progress' }),
    ).rejects.toThrow();

    // The important half: it failed BEFORE the lock, so nothing was touched.
    expect((await taskRow(subject())).status).toBe('planned');
    expect(await auditFor(subject())).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// §13.4.5 setTaskStatusProtected — the manager overrides.
// ═════════════════════════════════════════════════════════════════════════════════════════

describe('the protected-status transition matrix (§13.4.5)', () => {
  for (const from of taskStatus.enumValues) {
    for (const to of PROTECTED) {
      // `approved` is refused from everywhere — the guard runs before the origin is consulted.
      const verdict =
        to === 'approved' ? 'GATE:use_review' : from === to ? 'no-op' : 'allowed (override)';

      it(`${from} → ${to} is ${verdict}`, async () => {
        await putTaskAt(subject(), { status: from });
        actAs(seed.projectManager.id);

        const before = await taskRow(subject());
        const result = await setTaskStatusProtected({
          taskId: subject(),
          version: before.version,
          status: to,
          // The note gate is exercised on its own below; supply one here so this loop measures
          // the TRANSITION rather than re-testing a missing note 8 times.
          ...(to === 'revision_required' && { note: 'Headings are still H3.' }),
        });

        if (to === 'approved') {
          expectFail(result, 'GATE', 'use_review');
          expect((await taskRow(subject())).status).toBe(from);
          expect(await auditFor(subject())).toHaveLength(0);
          return;
        }

        const row = expectOk(result);
        expect(row.status).toBe(to);

        const stored = await taskRow(subject());
        expect(stored.status).toBe(to);

        if (from === to) {
          expect(stored.version).toBe(before.version);
          expect(await auditFor(subject())).toHaveLength(0);
        } else {
          expect(stored.version).toBe(before.version + 1);
          // Every protected move is audited as the override, never as a plain status change.
          const audit = await auditFor(subject());
          expect(audit).toHaveLength(1);
          expect(audit[0].action).toBe('project_task.status_overridden');
        }
      });
    }
  }
});

describe('the QC bypass is loud (§4.2, §13.4.5)', () => {
  it('completed from a non-terminal state is ALLOWED and audited as status_overridden', async () => {
    // This is the bypass §4.2 deliberately permits: a manager marking work done without it
    // passing through review. What makes it acceptable is that the audit names it as an
    // override, so "how often did we skip QC?" is one grep.
    await putTaskAt(subject(), { status: 'in_progress' });
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());
    const row = expectOk(
      await setTaskStatusProtected({
        taskId: subject(),
        version: before.version,
        status: 'completed',
      }),
    );

    expect(row.status).toBe('completed');

    const audit = await auditFor(subject());
    expect(audit).toHaveLength(1);
    // THE assertion this ticket turns on — the distinct action string.
    expect(audit[0].action).toBe('project_task.status_overridden');
    expect(audit[0].action).not.toBe('project_task.status_changed');
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      resourceType: 'project_task',
      before: { status: 'in_progress', version: 1 },
      after: { status: 'completed', version: 2 },
    });
  });

  it('the two paths never share an action string', async () => {
    // Move the same task twice — once by the pill, once by the override — and the audit log
    // must distinguish them. If either path were renamed to match the other, the bypass would
    // become invisible in exactly the query that exists to find it.
    actAs(seed.projectManager.id);

    expectOk(await changeTaskStatusOpen({ taskId: subject(), version: 1, status: 'in_progress' }));
    expectOk(
      await setTaskStatusProtected({ taskId: subject(), version: 2, status: 'completed' }),
    );

    const actions = (await auditFor(subject())).map((a) => a.action);
    expect(actions).toEqual(['project_task.status_changed', 'project_task.status_overridden']);
  });
});

describe('the protected gates (§13.4.5)', () => {
  it('direct approve is refused with GATE:use_review from every non-terminal state', async () => {
    actAs(seed.projectManager.id);

    for (const from of ['planned', 'in_progress', 'blocked', 'revision_required', 'submitted'] as const) {
      await putTaskAt(subject(), { status: from });
      const before = await taskRow(subject());

      expectFail(
        await setTaskStatusProtected({
          taskId: subject(),
          version: before.version,
          status: 'approved',
        }),
        'GATE',
        'use_review',
      );

      expect((await taskRow(subject())).status, `origin ${from}`).toBe(from);
    }

    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('revision_required without a note is refused with GATE:note_required', async () => {
    await putTaskAt(subject(), { status: 'submitted' });
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());

    expectFail(
      await setTaskStatusProtected({
        taskId: subject(),
        version: before.version,
        status: 'revision_required',
      }),
      'GATE',
      'note_required',
    );

    expect((await taskRow(subject())).status).toBe('submitted');
    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('revision_required WITH a note is allowed, and the note lands in the audit payload', async () => {
    await putTaskAt(subject(), { status: 'submitted' });
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());
    const row = expectOk(
      await setTaskStatusProtected({
        taskId: subject(),
        version: before.version,
        status: 'revision_required',
        note: 'Meta descriptions are missing on four pages.',
      }),
    );

    expect(row.status).toBe('revision_required');

    const audit = await auditFor(subject());
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({
      status: 'revision_required',
      note: 'Meta descriptions are missing on four pages.',
    });

    // §11.3 keeps the latest note on the row as a denormalized convenience.
    expect((await taskRow(subject())).revisionNote).toBe(
      'Meta descriptions are missing on four pages.',
    );
  });

  it('cancelling a submitted task resolves the submission by dropping out of the queue', async () => {
    // §13.4.5: no orphan handling is needed. The review queue reads only `status = 'submitted'`
    // (the pt_review_q_idx predicate), so a cancelled task simply disappears from it and the
    // submission record survives as proof the work WAS submitted.
    const task = seed.tasks[2].id; // seeded submitted
    actAs(seed.projectManager.id);

    const queueBefore = await db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(and(eq(projectTasks.status, 'submitted'), isNull(projectTasks.deletedAt)));
    expect(queueBefore.map((t) => t.id)).toContain(task);

    const before = await taskRow(task);
    const row = expectOk(
      await setTaskStatusProtected({
        taskId: task,
        version: before.version,
        status: 'cancelled',
      }),
    );

    expect(row.status).toBe('cancelled');

    const queueAfter = await db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(and(eq(projectTasks.status, 'submitted'), isNull(projectTasks.deletedAt)));
    expect(queueAfter.map((t) => t.id)).not.toContain(task);

    // The row itself is still there — cancelled, not deleted.
    expect(await taskRow(task)).toBeDefined();
  });
});

describe('setTaskStatusProtected is MGR-only (§9.6)', () => {
  it('a plain employee is denied', async () => {
    actAs(seed.employees[1].id);

    expectFail(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'completed' }),
      'FORBIDDEN',
    );

    expect((await taskRow(subject())).status).toBe('planned');
    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('even the ASSIGNEE is denied — there is no row-level path into this action', async () => {
    // The contrast with §13.4.4 is the point: being the assignee buys an employee the pill,
    // never the override. §9.6's cell here is a flat deny, not the conditional `assignee`.
    const task = seed.tasks[1].id; // assigned to employees[0]
    actAs(seed.employees[0].id);

    const before = await taskRow(task);
    expect(before.assigneeId).toBe(seed.employees[0].id);

    expectFail(
      await setTaskStatusProtected({
        taskId: task,
        version: before.version,
        status: 'completed',
      }),
      'FORBIDDEN',
    );

    expect((await taskRow(task)).status).toBe(before.status);
  });

  it('HR is denied', async () => {
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.employees[0].id);

    expectFail(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'cancelled' }),
      'FORBIDDEN',
    );
  });

  it('MUTATION PROOF: the employee deny is the matrix, not an accident of the fixture', async () => {
    await db
      .update(userTable)
      .set({ role: 'project_manager' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    const row = expectOk(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'completed' }),
    );

    expect(row.status).toBe('completed');
  });
});

describe('setTaskStatusProtected — lock, notify and the rest', () => {
  it('reuses the optimistic lock: a stale version is a CONFLICT and changes nothing', async () => {
    actAs(seed.projectManager.id);

    await db.update(projectTasks).set({ version: 2 }).where(eq(projectTasks.id, subject()));

    expectFail(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'completed' }),
      'CONFLICT',
      'stale_version',
    );

    const after = await taskRow(subject());
    expect(after.status).toBe('planned');
    expect(after.version).toBe(2);
    expect(await auditFor(subject())).toHaveLength(0);
  });

  it('notifies the assignee with task_status_changed on an override', async () => {
    const task = seed.tasks[1].id; // assigned to employees[0]
    actAs(seed.projectManager.id);

    const before = await taskRow(task);
    expectOk(
      await setTaskStatusProtected({
        taskId: task,
        version: before.version,
        status: 'completed',
      }),
    );

    const sent = __sentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: seed.employees[0].id,
      type: 'task_status_changed',
      data: { taskId: task, status: 'completed' },
    });
  });

  it('notifies nobody when the task is unassigned', async () => {
    actAs(seed.projectManager.id); // `subject()` is unassigned

    expectOk(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'completed' }),
    );

    expect(__sentNotifications()).toHaveLength(0);
  });

  it('notifies nobody on a no-op', async () => {
    await putTaskAt(subject(), { status: 'cancelled', assigneeId: seed.employees[0].id });
    actAs(seed.projectManager.id);

    const before = await taskRow(subject());
    expectOk(
      await setTaskStatusProtected({
        taskId: subject(),
        version: before.version,
        status: 'cancelled',
      }),
    );

    expect(await auditFor(subject())).toHaveLength(0);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('rejects a missing task with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(
      await setTaskStatusProtected({
        taskId: 'pt_does_not_exist',
        version: 1,
        status: 'completed',
      }),
      'NOT_FOUND',
    );
  });

  it('rejects a soft-deleted task with NOT_FOUND', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, subject()));
    actAs(seed.projectManager.id);

    expectFail(
      await setTaskStatusProtected({ taskId: subject(), version: 1, status: 'completed' }),
      'NOT_FOUND',
    );
  });
});
