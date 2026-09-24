// features/projects/filtered-tasks.test.ts — PUL-408.3
//
// `getFilteredTasks`, the one filtered-tasks read Board, List and Calendar all share. NOT a
// §15.4 mandatory file (the manifest is unchanged), but it earns a test under §15.2's "rules
// that silently break the business if wrong": every tab renders whatever this returns, so a
// wrong predicate here is wrong everywhere at once, and the exclusions (archived project,
// soft-deleted task, terminal statuses) are invisible failures — tasks that simply aren't there.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The only stub is
// `auth.api.getSession`. Rows are arranged by raw insert with clock-derived timestamps.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { clients, projects, projectTasks, taskSubtasks } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getFilteredTasks } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** Ids only — every assertion here is about WHICH tasks come back, not their order. */
async function idsFor(...args: Parameters<typeof getFilteredTasks>) {
  const rows = await getFilteredTasks(...args);
  return rows.map((r) => r.id).sort();
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  // A plain employee: the read is open to every role, so the viewer should not change results.
  actAs(seed.employees[1].id);
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('getFilteredTasks — the default result set', () => {
  it('returns every live task across both seeded projects with no filters', async () => {
    // seedFull: 3 tasks on proj_seed (planned / in_progress / submitted) + 3 on proj_seed_2
    // (approved / revision_required / planned). None is terminal, so all six survive.
    expect(await idsFor()).toEqual([
      'pt_seed_1',
      'pt_seed_2',
      'pt_seed_3',
      'pt_seed_4',
      'pt_seed_5',
      'pt_seed_6',
    ]);
  });

  it('keeps `approved` but excludes `completed` and `cancelled`', async () => {
    // The flagged decision in the query's docblock, pinned: `approved` is the normal end of the
    // QC path and stays visible; the two terminal statuses drop out of every tab.
    await db
      .update(projectTasks)
      .set({ status: 'completed' })
      .where(eq(projectTasks.id, 'pt_seed_1'));
    await db
      .update(projectTasks)
      .set({ status: 'cancelled' })
      .where(eq(projectTasks.id, 'pt_seed_2'));

    const ids = await idsFor();
    expect(ids).not.toContain('pt_seed_1');
    expect(ids).not.toContain('pt_seed_2');
    // pt_seed_4 is `approved` in the fixture and must NOT have been swept up with them.
    expect(ids).toContain('pt_seed_4');
  });

  it('excludes soft-deleted tasks', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, 'pt_seed_3'));

    expect(await idsFor()).not.toContain('pt_seed_3');
  });

  it('excludes every task on an archived project', async () => {
    await db
      .update(projects)
      .set({ status: 'archived' })
      .where(eq(projects.id, seed.secondProject.id));

    // All three of the second project's tasks go, and the first project's are untouched.
    expect(await idsFor()).toEqual(['pt_seed_1', 'pt_seed_2', 'pt_seed_3']);
  });

  it('excludes every task on a soft-deleted project', async () => {
    await db
      .update(projects)
      .set({ deletedAt: NOW })
      .where(eq(projects.id, seed.secondProject.id));

    expect(await idsFor()).toEqual(['pt_seed_1', 'pt_seed_2', 'pt_seed_3']);
  });

  it('requires an authenticated, active user', async () => {
    getSession.mockResolvedValue(null);
    await expect(getFilteredTasks()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('getFilteredTasks — the four filters', () => {
  it('filters by client, across that client’s projects', async () => {
    // Both seeded projects belong to the same client, so a second client is needed to prove the
    // predicate bites rather than being vacuously true.
    await db.insert(clients).values({ id: 'cl_other', name: 'Other Client' });
    await db.insert(projects).values({
      id: 'proj_other',
      clientId: 'cl_other',
      name: 'Other Retainer',
      type: 'Retainer',
      startDate: '2026-02-01',
      createdBy: seed.projectManager.id,
    });
    await db.insert(projectTasks).values({
      id: 'pt_other',
      projectId: 'proj_other',
      month: 1,
      category: 'Content',
      title: 'Other task',
      status: 'planned',
      priority: 'medium',
      createdBy: seed.projectManager.id,
    });

    expect(await idsFor({ clientId: 'cl_other' })).toEqual(['pt_other']);
    // The seed client still returns its six and not the newcomer.
    expect(await idsFor({ clientId: seed.client.id })).not.toContain('pt_other');
  });

  it('filters by project', async () => {
    expect(await idsFor({ projectId: seed.secondProject.id })).toEqual([
      'pt_seed_4',
      'pt_seed_5',
      'pt_seed_6',
    ]);
  });

  it('filters by month, and `month: null` tasks appear only under "all"', async () => {
    // The fixture puts the first project in month 1 and the second in month 2.
    expect(await idsFor({ month: 1 })).toEqual(['pt_seed_1', 'pt_seed_2', 'pt_seed_3']);
    expect(await idsFor({ month: 2 })).toEqual(['pt_seed_4', 'pt_seed_5', 'pt_seed_6']);

    // One-off work carries no month. It must not be swept into any numbered cycle, and must
    // still be reachable — otherwise a one-off task is invisible on a filtered board forever.
    await db.update(projectTasks).set({ month: null }).where(eq(projectTasks.id, 'pt_seed_1'));

    expect(await idsFor({ month: 1 })).toEqual(['pt_seed_2', 'pt_seed_3']);
    expect(await idsFor({ month: 'all' })).toContain('pt_seed_1');
    expect(await idsFor()).toContain('pt_seed_1');
  });

  it('filters by a specific assignee', async () => {
    // pt_seed_2 → employees[0]; pt_seed_4 → employees[1]; pt_seed_5 → employees[2].
    expect(await idsFor({ assigneeId: seed.employees[0].id })).toEqual(['pt_seed_2']);
  });

  it("filters by 'unassigned' (assignee_id IS NULL), which is not a user id", async () => {
    // pt_seed_1 and pt_seed_6 are the fixture's claimable tasks.
    expect(await idsFor({ assigneeId: 'unassigned' })).toEqual(['pt_seed_1', 'pt_seed_6']);
  });

  it("treats 'all' and an omitted key as the same thing", async () => {
    // The §16.10 contract: the filter bar never has to strip a key it is holding.
    const everything = await idsFor();
    expect(await idsFor({ month: 'all', assigneeId: 'all' })).toEqual(everything);
    expect(await idsFor({})).toEqual(everything);
  });

  it('combines filters conjunctively', async () => {
    expect(
      await idsFor({
        clientId: seed.client.id,
        projectId: seed.secondProject.id,
        month: 2,
        assigneeId: seed.employees[2].id,
      }),
    ).toEqual(['pt_seed_5']);
  });
});

describe('getFilteredTasks — the computed columns', () => {
  it('counts subtasks done/total, and reports 0/0 for a task with none', async () => {
    await db.insert(taskSubtasks).values([
      {
        id: 'st_1',
        taskId: 'pt_seed_2',
        text: 'one',
        done: true,
        position: 0,
        createdBy: seed.employees[0].id,
      },
      {
        id: 'st_2',
        taskId: 'pt_seed_2',
        text: 'two',
        done: false,
        position: 1,
        createdBy: seed.employees[0].id,
      },
      {
        id: 'st_3',
        taskId: 'pt_seed_2',
        text: 'three',
        done: true,
        position: 2,
        createdBy: seed.employees[0].id,
      },
    ]);

    const rows = await getFilteredTasks();
    const withSubtasks = rows.find((r) => r.id === 'pt_seed_2');
    expect(withSubtasks).toMatchObject({ subtaskDone: 2, subtaskTotal: 3 });

    // The LEFT JOIN must not drop a task that has no subtasks, and its counts must be numbers
    // rather than the NULLs the join produces — §14.3.1 hides the badge at zero, and `null`
    // would render as a badge saying "null/null".
    expect(rows.find((r) => r.id === 'pt_seed_1')).toMatchObject({
      subtaskDone: 0,
      subtaskTotal: 0,
    });
    // Six tasks in, six tasks out: the grouped subquery did not multiply rows.
    expect(rows).toHaveLength(6);
  });

  it('computes dependencyBlocked from the upstream status, not from the stored status', async () => {
    // pt_seed_2 (in_progress) now waits on pt_seed_3 (submitted → not finished).
    await db
      .update(projectTasks)
      .set({ dependsOn: 'pt_seed_3' })
      .where(eq(projectTasks.id, 'pt_seed_2'));

    const blocked = (await getFilteredTasks()).find((r) => r.id === 'pt_seed_2');
    expect(blocked?.dependencyBlocked).toBe(true);
    // §3.2.5 is display-only: the stored status is untouched, never rewritten to `blocked`.
    expect(blocked?.status).toBe('in_progress');

    // `approved` satisfies the dependency and the lock lifts.
    await db
      .update(projectTasks)
      .set({ status: 'approved' })
      .where(eq(projectTasks.id, 'pt_seed_3'));
    expect((await getFilteredTasks()).find((r) => r.id === 'pt_seed_2')?.dependencyBlocked).toBe(
      false,
    );

    // `cancelled` deliberately does NOT: a cancelled upstream task is an open question about
    // the downstream one, not a green light (DEPENDENCY_SATISFIED_STATUSES).
    await db
      .update(projectTasks)
      .set({ status: 'cancelled' })
      .where(eq(projectTasks.id, 'pt_seed_3'));
    expect((await getFilteredTasks()).find((r) => r.id === 'pt_seed_2')?.dependencyBlocked).toBe(
      true,
    );
  });

  it('names the blocking task in blockedByTitle only while the dependency blocks', async () => {
    await db
      .update(projectTasks)
      .set({ dependsOn: 'pt_seed_3', title: 'Upstream audit' })
      .where(eq(projectTasks.id, 'pt_seed_2'));
    await db
      .update(projectTasks)
      .set({ title: 'Keyword research' })
      .where(eq(projectTasks.id, 'pt_seed_3'));

    // pt_seed_3 is `submitted` — not finished — so pt_seed_2 is blocked BY it.
    const blocked = (await getFilteredTasks()).find((r) => r.id === 'pt_seed_2');
    expect(blocked).toMatchObject({ dependencyBlocked: true, blockedByTitle: 'Keyword research' });

    // Once the upstream is approved the lock lifts, and the title goes with it — a satisfied
    // dependency must not leave a tooltip naming a task that no longer blocks anything.
    await db
      .update(projectTasks)
      .set({ status: 'approved' })
      .where(eq(projectTasks.id, 'pt_seed_3'));
    const freed = (await getFilteredTasks()).find((r) => r.id === 'pt_seed_2');
    expect(freed).toMatchObject({ dependencyBlocked: false, blockedByTitle: null });

    // No dependency at all → null, never an empty string.
    expect((await getFilteredTasks()).find((r) => r.id === 'pt_seed_1')?.blockedByTitle).toBeNull();
  });

  it('returns the row version, so an inline status write can carry the optimistic lock', async () => {
    await db
      .update(projectTasks)
      .set({ version: 7 })
      .where(eq(projectTasks.id, 'pt_seed_2'));

    const rows = await getFilteredTasks();
    expect(rows.find((r) => r.id === 'pt_seed_2')?.version).toBe(7);
    expect(rows.every((r) => Number.isInteger(r.version))).toBe(true);
  });

  it('reports dependencyBlocked false when there is no dependency at all', async () => {
    expect((await getFilteredTasks()).every((r) => r.dependencyBlocked === false)).toBe(true);
  });

  it('returns estimatedHours as a number (not pg’s numeric string), or null when unestimated', async () => {
    // PUL-410's Est column. `numeric(6,2)` comes back from pg as '2.50'; the row must carry
    // 2.5, or `fmtHM` renders a string and sums concatenate instead of adding.
    await db
      .update(projectTasks)
      .set({ estimatedHours: '2.50' })
      .where(eq(projectTasks.id, 'pt_seed_2'));
    await db
      .update(projectTasks)
      .set({ estimatedHours: null })
      .where(eq(projectTasks.id, 'pt_seed_1'));

    const rows = await getFilteredTasks();
    expect(rows.find((r) => r.id === 'pt_seed_2')?.estimatedHours).toBe(2.5);
    expect(rows.find((r) => r.id === 'pt_seed_1')?.estimatedHours).toBeNull();
  });

  it('returns the assignee as one nullable object, never a half-built person', async () => {
    const rows = await getFilteredTasks();

    expect(rows.find((r) => r.id === 'pt_seed_2')?.assignee).toMatchObject({
      id: seed.employees[0].id,
      name: seed.employees[0].name,
    });
    expect(rows.find((r) => r.id === 'pt_seed_1')?.assignee).toBeNull();
  });

  it('orders by priority (urgent first), then due date with NULLs last, then created_at', async () => {
    await db
      .update(projectTasks)
      .set({ dueDate: '2026-09-30' })
      .where(eq(projectTasks.id, 'pt_seed_3')); // high
    await db
      .update(projectTasks)
      .set({ dueDate: '2026-09-20' })
      .where(eq(projectTasks.id, 'pt_seed_5')); // high, earlier → ahead of pt_seed_3

    const ids = (await getFilteredTasks()).map((r) => r.id);

    // pt_seed_6 is the only `urgent` task in the fixture.
    expect(ids[0]).toBe('pt_seed_6');
    expect(ids.indexOf('pt_seed_5')).toBeLessThan(ids.indexOf('pt_seed_3'));
    // `low` sorts last: pt_seed_1 is the fixture's only one.
    expect(ids.at(-1)).toBe('pt_seed_1');
  });

  it('is stable — the same filters return the same order twice', async () => {
    const first = (await getFilteredTasks()).map((r) => r.id);
    const second = (await getFilteredTasks()).map((r) => r.id);
    expect(second).toEqual(first);
  });
});
