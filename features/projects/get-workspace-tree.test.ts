// features/projects/get-workspace-tree.test.ts (PUL-417.7, query half)
//
// §13.8 `getWorkspaceTree` against the real easygrowcrm_test database: the nested shape, the
// per-project task counts, what the live-only default hides, and that the number of queries
// does not grow with the tree (no N+1). The pure helpers are in workspace-tree.test.ts.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { accounts, clients, projects, projectTasks } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';
import type { WorkspaceTree } from './workspace-tree';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getWorkspaceTree } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

beforeEach(async () => {
  seed = await seedMinimal();
  setClock(createTestClock(NOW));
  getSession.mockResolvedValue({ user: { id: seed.employees[0].id } });
});

afterEach(() => {
  vi.restoreAllMocks();
  getSession.mockReset();
  resetClock();
});

type TaskStatus = (typeof projectTasks.$inferSelect)['status'];

async function addClient(id: string, name: string) {
  await db.insert(clients).values({ id, name });
}

async function addAccount(id: string, clientId: string, name: string) {
  await db.insert(accounts).values({ id, clientId, name });
}

async function addProject(id: string, accountId: string, name: string) {
  await db.insert(projects).values({
    id,
    accountId,
    name,
    type: 'One-off',
    startDate: '2026-01-01',
    createdBy: seed.projectManager.id,
  });
}

async function addTasks(projectId: string, statuses: TaskStatus[]) {
  if (statuses.length === 0) return;
  await db.insert(projectTasks).values(
    statuses.map((status, i) => ({
      id: `${projectId}_t${i}`,
      projectId,
      category: 'Content',
      title: `Task ${i}`,
      status,
      priority: 'medium' as const,
      createdBy: seed.projectManager.id,
    })),
  );
}

/** `client/account/project` paths, in tree order. */
function paths(tree: WorkspaceTree): string[] {
  const out: string[] = [];
  for (const c of tree) {
    out.push(c.id);
    for (const a of c.accounts) {
      out.push(`${c.id}/${a.id}`);
      for (const p of a.projects) out.push(`${c.id}/${a.id}/${p.id}`);
    }
  }
  return out;
}

function findProject(tree: WorkspaceTree, id: string) {
  return tree.flatMap((c) => c.accounts.flatMap((a) => a.projects)).find((p) => p.id === id);
}

/** Runs `fn` and returns how many SQL statements it sent to the pool. */
async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(db.$client, 'query');
  try {
    await fn();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('getWorkspaceTree', () => {
  it('returns the nested Client > Account > Project shape', async () => {
    const tree = await getWorkspaceTree();

    expect(tree).toEqual([
      {
        id: seed.client.id,
        name: 'Seed Client',
        archived: false,
        accounts: [
          {
            id: seed.account.id,
            name: 'Seed Account',
            location: null,
            archived: false,
            projects: [
              {
                id: seed.project.id,
                name: 'Seed Retainer',
                startDate: '2026-01-01',
                archived: false,
                // Seed tasks: planned, in_progress, submitted.
                openTaskCount: 3,
                awaitingReviewCount: 1,
                awaitingReview: true,
                doneTaskCount: 0,
                totalTaskCount: 3,
                // The seed tasks carry no due date, so none can be overdue.
                overdueTaskCount: 0,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps childless clients and accounts, and sorts every level by name', async () => {
    await addClient('c_zeta', 'Zeta Partners');
    await addClient('c_alpha', 'Alpha Partners');
    await addAccount('a_empty', 'c_alpha', 'Empty Account');
    await addAccount('a_beta', seed.client.id, 'Beta Account');
    await addProject('p_b', 'a_beta', 'B Project');
    await addProject('p_a', 'a_beta', 'A Project');

    expect(paths(await getWorkspaceTree())).toEqual([
      'c_alpha',
      'c_alpha/a_empty',
      `${seed.client.id}`,
      `${seed.client.id}/a_beta`,
      `${seed.client.id}/a_beta/p_a`,
      `${seed.client.id}/a_beta/p_b`,
      `${seed.client.id}/${seed.account.id}`,
      `${seed.client.id}/${seed.account.id}/${seed.project.id}`,
      'c_zeta',
    ]);
  });

  it('counts overdue over OPEN tasks due before today in Dhaka (§3.1.3)', async () => {
    // Frozen clock: 2026-09-15 in Asia/Dhaka.
    await addProject('p_due', seed.account.id, 'Due dates');
    await addTasks('p_due', [
      'planned',
      'in_progress',
      'planned',
      'approved',
      'cancelled',
      'planned',
    ]);
    const due = (i: number, dueDate: string | null) =>
      db
        .update(projectTasks)
        .set({ dueDate })
        .where(eq(projectTasks.id, `p_due_t${i}`));
    await due(0, '2026-09-14'); // yesterday, open: overdue
    await due(1, '2026-01-01'); // long past, open: overdue
    await due(2, '2026-09-15'); // today: not overdue (strictly before)
    await due(3, '2026-01-01'); // past but approved: closed, not overdue
    await due(4, '2026-01-01'); // past but cancelled: not overdue
    await due(5, null); // no due date: never overdue

    expect(findProject(await getWorkspaceTree(), 'p_due')?.overdueTaskCount).toBe(2);
  });

  it('counts open, awaiting review, done and total per project, ignoring deleted tasks', async () => {
    await addProject('p_mix', seed.account.id, 'Mixed');
    await addTasks('p_mix', [
      'planned',
      'in_progress',
      'blocked',
      'revision_required',
      'submitted',
      'submitted',
      'approved',
      'completed',
      'cancelled',
      'planned',
    ]);
    // The last planned task is soft-deleted and must not count anywhere.
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, 'p_mix_t9'));
    await addProject('p_idle', seed.account.id, 'Idle');
    await addProject('p_closed', seed.account.id, 'Closed');
    await addTasks('p_closed', ['approved', 'cancelled']);

    const tree = await getWorkspaceTree();

    expect(findProject(tree, 'p_mix')).toMatchObject({
      openTaskCount: 6,
      awaitingReviewCount: 2,
      awaitingReview: true,
      doneTaskCount: 2,
      totalTaskCount: 8,
    });
    expect(findProject(tree, 'p_idle')).toMatchObject({
      openTaskCount: 0,
      awaitingReviewCount: 0,
      awaitingReview: false,
      doneTaskCount: 0,
      totalTaskCount: 0,
    });
    expect(findProject(tree, 'p_closed')).toMatchObject({
      openTaskCount: 0,
      awaitingReview: false,
      doneTaskCount: 1,
      totalTaskCount: 1,
    });
  });

  it('excludes archived clients, accounts and projects by default', async () => {
    await addProject('p_archived', seed.account.id, 'Archived Project');
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, 'p_archived'));

    await addAccount('a_archived', seed.client.id, 'Archived Account');
    await addProject('p_under_archived', 'a_archived', 'Under Archived Account');
    await db.update(accounts).set({ deletedAt: NOW }).where(eq(accounts.id, 'a_archived'));

    await addClient('c_archived', 'Archived Client');
    await addAccount('a_under_archived', 'c_archived', 'Under Archived Client');
    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, 'c_archived'));

    expect(paths(await getWorkspaceTree())).toEqual([
      seed.client.id,
      `${seed.client.id}/${seed.account.id}`,
      `${seed.client.id}/${seed.account.id}/${seed.project.id}`,
    ]);
  });

  it('keeps a live account whose only project is archived', async () => {
    await addAccount('a_lonely', seed.client.id, 'Lonely Account');
    await addProject('p_gone', 'a_lonely', 'Gone');
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, 'p_gone'));

    const account = (await getWorkspaceTree())[0].accounts.find((a) => a.id === 'a_lonely');
    expect(account).toMatchObject({ archived: false, projects: [] });
  });

  it('returns archived nodes, flagged, with includeArchived', async () => {
    await addProject('p_archived', seed.account.id, 'Archived Project');
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, 'p_archived'));
    await addClient('c_archived', 'Archived Client');
    await addAccount('a_archived', 'c_archived', 'Archived Account');
    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, 'c_archived'));
    await db.update(accounts).set({ deletedAt: NOW }).where(eq(accounts.id, 'a_archived'));

    const tree = await getWorkspaceTree({ includeArchived: true });

    expect(paths(tree)).toContain(`${seed.client.id}/${seed.account.id}/p_archived`);
    expect(findProject(tree, 'p_archived')?.archived).toBe(true);
    expect(findProject(tree, seed.project.id)?.archived).toBe(false);
    const archivedClient = tree.find((c) => c.id === 'c_archived');
    expect(archivedClient).toMatchObject({
      archived: true,
      accounts: [{ id: 'a_archived', archived: true }],
    });
  });

  it('never returns a soft-deleted project, even with includeArchived', async () => {
    await db.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, seed.project.id));

    expect(
      findProject(await getWorkspaceTree({ includeArchived: true }), seed.project.id),
    ).toBeUndefined();
  });

  it('runs a fixed number of queries however large the tree is', async () => {
    const small = await countQueries(() => getWorkspaceTree());

    for (const c of [1, 2, 3]) {
      await addClient(`c_${c}`, `Client ${c}`);
      for (const a of [1, 2]) {
        await addAccount(`a_${c}_${a}`, `c_${c}`, `Account ${c}.${a}`);
        for (const p of [1, 2]) {
          await addProject(`p_${c}_${a}_${p}`, `a_${c}_${a}`, `Project ${c}.${a}.${p}`);
          await addTasks(`p_${c}_${a}_${p}`, ['planned', 'submitted', 'approved']);
        }
      }
    }

    const large = await countQueries(() => getWorkspaceTree());
    const tree = await getWorkspaceTree();
    expect(tree.flatMap((c) => c.accounts.flatMap((a) => a.projects))).toHaveLength(13);

    // One session read (role + active from the DB, §16.5) plus the one tree select.
    expect(small).toBe(2);
    expect(large).toBe(small);
  });

  it('gives every role the same tree (§9.6: account.read and project_task.read are open)', async () => {
    const asEmployee = await getWorkspaceTree();
    getSession.mockResolvedValue({ user: { id: seed.superAdmin.id } });
    expect(await getWorkspaceTree()).toEqual(asEmployee);
  });

  it('requires an authenticated, active user', async () => {
    getSession.mockResolvedValue(null);
    await expect(getWorkspaceTree()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
