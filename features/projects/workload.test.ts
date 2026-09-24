// features/projects/workload.test.ts — PUL-412.3
//
// `getWorkload`, the Workload tab's per-person open-task capacity read (§14.3.6). NOT a §15.4
// mandatory file. What it pins: which statuses count as open, that a dependency-blocked task
// still counts (§3.2.5), that unassigned work is attributed to nobody, the est-hours sum
// (numeric → number, NULL → 0), the project scope, and the `onBreak` stub.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The only stub is
// `auth.api.getSession`.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { projects, projectTasks } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getWorkload, getFilteredTasks } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/**
 * On top of seedFull's six tasks (open: pt_seed_2 e1, pt_seed_3 TL, pt_seed_5 e3; approved:
 * pt_seed_4 e2; unassigned: pt_seed_1, pt_seed_6):
 *
 *   pt_w_blocked   — e1, `planned` but waiting on pt_seed_3 (submitted) → dependency-BLOCKED,
 *                    est 1.25, on proj_seed_2. Must still count.
 *   pt_w_completed — e1, `completed`, est 10 → excluded.
 *   pt_w_cancelled — e1, `cancelled`, est 10 → excluded.
 *   pt_seed_2      — gets est 2.50.
 *
 * So e1 holds 2 open tasks / 3.75h; TL 1 / 0h (unestimated); e3 1 / 0h; e2 nothing open.
 */
async function arrange() {
  const e1 = seed.employees[0];

  await db
    .update(projectTasks)
    .set({ estimatedHours: '2.50' })
    .where(eq(projectTasks.id, 'pt_seed_2'));

  const base = {
    category: 'Workload',
    priority: 'medium' as const,
    assigneeId: e1.id,
    createdBy: seed.projectManager.id,
  };
  await db.insert(projectTasks).values([
    {
      ...base,
      id: 'pt_w_blocked',
      title: 'Blocked by a dependency',
      projectId: 'proj_seed_2',
      status: 'planned' as const,
      dependsOn: 'pt_seed_3',
      estimatedHours: '1.25',
    },
    {
      ...base,
      id: 'pt_w_completed',
      title: 'Closed by a manager',
      projectId: 'proj_seed',
      status: 'completed' as const,
      estimatedHours: '10.00',
    },
    {
      ...base,
      id: 'pt_w_cancelled',
      title: 'Scope cut',
      projectId: 'proj_seed',
      status: 'cancelled' as const,
      estimatedHours: '10.00',
    },
  ]);
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  actAs(seed.projectManager.id);
  await arrange();
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

/** `[userId, openCount, estHours]` triples — the numbers under test, in the query's order. */
async function summary(...args: Parameters<typeof getWorkload>) {
  return (await getWorkload(...args)).map((r) => [r.user.id, r.openCount, r.estHours]);
}

describe('getWorkload — agency-wide', () => {
  it('counts open tasks and sums est hours per person, most loaded first', async () => {
    const [e1, , e3] = seed.employees;
    // Ties at 1 open task break on name: "Seed Employee Three" < "Seed TeamLeader".
    expect(await summary()).toEqual([
      [e1.id, 2, 3.75],
      [e3.id, 1, 0],
      [seed.teamLeader.id, 1, 0],
    ]);
  });

  it('still counts a dependency-blocked task as open (§3.2.5 / §14.3.6)', async () => {
    // The display-only lock really is on: the board would draw a padlock on this task…
    const blocked = (await getFilteredTasks()).find((r) => r.id === 'pt_w_blocked');
    expect(blocked?.dependencyBlocked).toBe(true);

    // …and workload counts it anyway: e1's 2 open tasks are pt_seed_2 + pt_w_blocked.
    const e1Row = (await getWorkload()).find((r) => r.user.id === seed.employees[0].id);
    expect(e1Row?.openCount).toBe(2);
  });

  it('excludes approved, completed and cancelled tasks', async () => {
    // e2's only task is approved → e2 is absent. e1's completed/cancelled 10h each are not in
    // e1's 3.75h.
    const rows = await getWorkload();
    expect(rows.map((r) => r.user.id)).not.toContain(seed.employees[1].id);
    expect(rows.find((r) => r.user.id === seed.employees[0].id)?.estHours).toBe(3.75);
  });

  it('attributes unassigned tasks to nobody — no row, no "null" person', async () => {
    const rows = await getWorkload();
    expect(rows.every((r) => typeof r.user.id === 'string' && r.user.id.length > 0)).toBe(true);
    // Total open count = the three assigned open tasks + the blocked one; pt_seed_1 and
    // pt_seed_6 (unassigned) are in nobody's count.
    expect(rows.reduce((n, r) => n + r.openCount, 0)).toBe(4);
  });

  it('excludes soft-deleted tasks and tasks on archived projects', async () => {
    await db
      .update(projectTasks)
      .set({ deletedAt: NOW })
      .where(eq(projectTasks.id, 'pt_seed_2'));
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, 'proj_seed_2'));
    // e1 loses pt_seed_2 (deleted) and pt_w_blocked (archived project); e3's pt_seed_5 goes too.
    expect(await summary()).toEqual([[seed.teamLeader.id, 1, 0]]);
  });

  it('returns estHours as a number, and onBreak false for everyone (Phase 3 stub)', async () => {
    const rows = await getWorkload();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.estHours).toBe('number');
      expect(row.onBreak).toBe(false);
    }
  });

  it('carries the person as { id, name, image }', async () => {
    const row = (await getWorkload()).find((r) => r.user.id === seed.teamLeader.id);
    expect(row?.user).toEqual({ id: seed.teamLeader.id, name: seed.teamLeader.name, image: null });
  });

  it('requires an authenticated, active user', async () => {
    getSession.mockResolvedValue(null);
    await expect(getWorkload()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('getWorkload — scoped to one project', () => {
  it('counts only that project’s open tasks', async () => {
    const [e1, , e3] = seed.employees;
    expect(await summary({ projectId: 'proj_seed' })).toEqual([
      [e1.id, 1, 2.5],
      [seed.teamLeader.id, 1, 0],
    ]);
    expect(await summary({ projectId: 'proj_seed_2' })).toEqual([
      [e1.id, 1, 1.25],
      [e3.id, 1, 0],
    ]);
  });

  it('per-project counts add up to the agency-wide count per person', async () => {
    const whole = await getWorkload();
    const parts = [
      ...(await getWorkload({ projectId: 'proj_seed' })),
      ...(await getWorkload({ projectId: 'proj_seed_2' })),
    ];
    for (const row of whole) {
      const mine = parts.filter((p) => p.user.id === row.user.id);
      expect(mine.reduce((n, p) => n + p.openCount, 0)).toBe(row.openCount);
      expect(mine.reduce((n, p) => n + p.estHours, 0)).toBeCloseTo(row.estHours);
    }
  });
});
