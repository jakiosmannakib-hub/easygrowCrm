// features/projects/review-queue.test.ts — PUL-412.1 / 412.4
//
// `getReviewQueue`, THE canonical review query (§16.9 / Amendment F): the project Review tab, the
// `/review` page (PUL-607) and the dashboard card (PUL-803) all read through it. NOT a §15.4
// mandatory file, but it carries PUL-412's "Done when" — **query identity across surfaces is
// proven by test** — in the QUERY-IDENTITY block below.
//
// First real consumer of `task_submissions`. The seed leaves the QC tables empty, so every case
// arranges its submissions by raw insert, with timestamps derived from the frozen clock's NOW.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The only stub is
// `auth.api.getSession`.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { projects, projectTasks, taskSubmissions } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getReviewQueue } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** An instant `hours` before the frozen NOW — every submission timestamp is clock-derived. */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/**
 * The arrangement most cases share. Three submitted tasks across both seeded projects:
 *
 *   pt_seed_3 (proj_seed)    — TL's work, ONE submission, routed to the PM, 2h ago.
 *   pt_seed_1 (proj_seed)    — e1's work, ONE submission, UNROUTED, 3h ago.
 *   pt_seed_5 (proj_seed_2)  — e3's work, TWO submissions (the revision loop):
 *                                an old one routed to the PM (5h ago, "first pass"),
 *                                the LATEST routed to the TL (1h ago, "resubmitted").
 *
 * Plus one submission on pt_seed_2, which is `in_progress` — a submission row must not drag a
 * task that isn't `submitted` into the queue.
 */
async function arrange() {
  const [e1, , e3] = seed.employees;

  await db
    .update(projectTasks)
    .set({ status: 'submitted', assigneeId: e1.id })
    .where(eq(projectTasks.id, 'pt_seed_1'));
  await db
    .update(projectTasks)
    .set({ status: 'submitted' })
    .where(eq(projectTasks.id, 'pt_seed_5'));

  await db.insert(taskSubmissions).values([
    {
      id: 'sub_3',
      taskId: 'pt_seed_3',
      submittedBy: seed.teamLeader.id,
      summary: 'Fixed the canonical tags',
      hours: '2.00',
      proofType: 'url',
      proofValue: 'https://example.test/pr/3',
      reviewerId: seed.projectManager.id,
      createdAt: hoursAgo(2),
    },
    {
      id: 'sub_1',
      taskId: 'pt_seed_1',
      submittedBy: e1.id,
      summary: 'On-page pass done',
      hours: null,
      proofType: null,
      proofValue: null,
      reviewerId: null,
      createdAt: hoursAgo(3),
    },
    {
      id: 'sub_5_old',
      taskId: 'pt_seed_5',
      submittedBy: e3.id,
      summary: 'first pass',
      hours: '4.00',
      proofType: 'url',
      proofValue: 'https://example.test/old',
      reviewerId: seed.projectManager.id,
      createdAt: hoursAgo(5),
    },
    {
      id: 'sub_5_new',
      taskId: 'pt_seed_5',
      submittedBy: e3.id,
      summary: 'resubmitted with the fixes',
      hours: '1.50',
      proofType: 'google_doc',
      proofValue: 'https://docs.example.test/new',
      reviewerId: seed.teamLeader.id,
      createdAt: hoursAgo(1),
    },
    {
      id: 'sub_2_stray',
      taskId: 'pt_seed_2',
      submittedBy: e1.id,
      summary: 'not actually submitted',
      reviewerId: seed.projectManager.id,
      createdAt: hoursAgo(4),
    },
  ]);
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  actAs(seed.projectManager.id); // a manager: review.read is `allow`
  await arrange();
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

const ids = (rows: { taskId: string }[]) => rows.map((r) => r.taskId);

describe('getReviewQueue — the base set', () => {
  it('returns only `submitted` tasks, newest submission first by default', async () => {
    // pt_seed_5 (1h) → pt_seed_3 (2h) → pt_seed_1 (3h). pt_seed_2 is in_progress: excluded
    // despite having a submission row.
    expect(ids(await getReviewQueue())).toEqual(['pt_seed_5', 'pt_seed_3', 'pt_seed_1']);
  });

  it("sorts 'oldest' first for the dashboard card's aging view", async () => {
    expect(ids(await getReviewQueue({ sort: 'oldest' }))).toEqual([
      'pt_seed_1',
      'pt_seed_3',
      'pt_seed_5',
    ]);
  });

  it('uses the LATEST submission when a task has several (revision + resubmit)', async () => {
    const rows = await getReviewQueue();
    // One row per task, however many submissions it has.
    expect(rows.filter((r) => r.taskId === 'pt_seed_5')).toHaveLength(1);
    expect(rows.find((r) => r.taskId === 'pt_seed_5')).toMatchObject({
      summary: 'resubmitted with the fixes',
      routedTo: { id: seed.teamLeader.id },
      submittedAt: hoursAgo(1),
    });
  });

  it('excludes a task on an archived project', async () => {
    await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, 'proj_seed_2'));
    expect(ids(await getReviewQueue())).toEqual(['pt_seed_3', 'pt_seed_1']);
  });

  it('excludes a task on a soft-deleted project', async () => {
    await db.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, 'proj_seed_2'));
    expect(ids(await getReviewQueue())).not.toContain('pt_seed_5');
  });

  it('excludes a soft-deleted task', async () => {
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, 'pt_seed_3'));
    expect(ids(await getReviewQueue())).toEqual(['pt_seed_5', 'pt_seed_1']);
  });

  it('requires an authenticated, active user', async () => {
    getSession.mockResolvedValue(null);
    await expect(getReviewQueue()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('getReviewQueue — row shape (§14.3.5 columns)', () => {
  it('carries task, project, submitter, routing, summary, hours, proof, time and version', async () => {
    await db.update(projectTasks).set({ version: 4 }).where(eq(projectTasks.id, 'pt_seed_5'));

    const row = (await getReviewQueue()).find((r) => r.taskId === 'pt_seed_5');
    expect(row).toEqual({
      taskId: 'pt_seed_5',
      taskTitle: 'Seed Task Revision',
      project: { id: 'proj_seed_2', name: 'Seed One-off' },
      submittedBy: { id: seed.employees[2].id, name: seed.employees[2].name },
      routedTo: { id: seed.teamLeader.id, name: seed.teamLeader.name },
      summary: 'resubmitted with the fixes',
      // numeric '1.50' from pg → the number 1.5, so fmtHM gets a number.
      hours: 1.5,
      proofType: 'google_doc',
      proofValue: 'https://docs.example.test/new',
      submittedAt: hoursAgo(1),
      version: 4,
    });
  });

  it('returns routedTo null, and null hours / proof, for an unrouted bare submission', async () => {
    expect((await getReviewQueue()).find((r) => r.taskId === 'pt_seed_1')).toMatchObject({
      routedTo: null,
      hours: null,
      proofType: null,
      proofValue: null,
    });
  });
});

describe('getReviewQueue — routedToMe', () => {
  it("keeps only tasks whose LATEST submission routes to the viewer", async () => {
    // The PM is routed pt_seed_3, and was routed pt_seed_5's OLD submission — which no longer
    // counts: the resubmission went to the TL.
    actAs(seed.projectManager.id);
    expect(ids(await getReviewQueue({ routedToMe: true }))).toEqual(['pt_seed_3']);

    actAs(seed.teamLeader.id);
    expect(ids(await getReviewQueue({ routedToMe: true }))).toEqual(['pt_seed_5']);
  });

  it('is empty for a manager nothing is routed to', async () => {
    actAs(seed.superAdmin.id);
    expect(await getReviewQueue({ routedToMe: true })).toEqual([]);
  });

  it('composes with projectId', async () => {
    actAs(seed.teamLeader.id);
    expect(await getReviewQueue({ routedToMe: true, projectId: 'proj_seed' })).toEqual([]);
  });
});

describe('getReviewQueue — §9.6 review.read role scope', () => {
  it('gives an employee only their OWN submissions (the `self` cell)', async () => {
    actAs(seed.employees[2].id);
    expect(ids(await getReviewQueue())).toEqual(['pt_seed_5']);

    actAs(seed.employees[1].id); // e2 has submitted nothing
    expect(await getReviewQueue()).toEqual([]);
  });

  it('gives every manager role the whole queue', async () => {
    for (const manager of [seed.superAdmin, seed.teamLeader, seed.projectManager]) {
      actAs(manager.id);
      expect(await getReviewQueue()).toHaveLength(3);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// QUERY IDENTITY — PUL-412.4, the ticket's "Done when"
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// The project Review tab calls `getReviewQueue({ projectId: X, ... })`; the `/review` page calls
// `getReviewQueue({ ... })` agency-wide. §16.9 says they are one query, so the tab's rows must be
// EXACTLY the agency-wide rows whose project is X — same rows, same fields, same order. If
// someone ever forks a "project review" query, or adds a predicate to one path only, this fails.

describe('getReviewQueue — QUERY IDENTITY across surfaces (412.4)', () => {
  const variants: { name: string; filters: { routedToMe?: boolean; sort?: 'newest' | 'oldest' } }[] =
    [
      { name: 'default (newest)', filters: {} },
      { name: 'oldest first', filters: { sort: 'oldest' } },
      { name: 'routed to me', filters: { routedToMe: true } },
    ];

  for (const { name, filters } of variants) {
    it(`project tab ≡ the project's slice of /review — ${name}`, async () => {
      const agencyWide = await getReviewQueue(filters);

      for (const projectId of ['proj_seed', 'proj_seed_2']) {
        const projectTab = await getReviewQueue({ ...filters, projectId });
        // Row-for-row equality (toEqual, in order), not a membership check.
        expect(projectTab).toEqual(agencyWide.filter((r) => r.project.id === projectId));
      }
    });
  }

  it('is non-trivial here: both projects have rows, so the equality compares real data', async () => {
    const agencyWide = await getReviewQueue();
    expect(agencyWide.filter((r) => r.project.id === 'proj_seed')).toHaveLength(2);
    expect(agencyWide.filter((r) => r.project.id === 'proj_seed_2')).toHaveLength(1);
  });

  it('the two projects partition the agency-wide queue — nothing lost, nothing added', async () => {
    const agencyWide = await getReviewQueue();
    const union = [
      ...(await getReviewQueue({ projectId: 'proj_seed' })),
      ...(await getReviewQueue({ projectId: 'proj_seed_2' })),
    ];
    expect(ids(union).sort()).toEqual(ids(agencyWide).sort());
  });
});
