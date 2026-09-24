// features/projects/load-review-workload.test.ts — PUL-412 Stage 2
//
// Not a §15.4 mandatory file. The gates on the two MGR/HR tab reads — the part of Stage 2 that
// is a permission rule, and so the part that silently breaks the business if wrong (§15.2):
//
//   - `loadReviewQueue` authorizes the exact §9.6 key `review.read`. SA / TL / PM / HR pass;
//     an employee's `self` cell fails closed with no resource → FORBIDDEN.
//   - `loadWorkload` has NO §9.6 row to authorize against, so it role-gates in the action.
//     SA / TL / PM / HR pass; an employee → FORBIDDEN.
//
// The queries' own behavior is covered by review-queue.test.ts and workload.test.ts; these only
// prove the actions let the right roles through and hand back the query's result.
//
// Rig: the real easygrowcrm_test database, no mocked `authorize()` (§15.8). The only stub is
// `auth.api.getSession`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { user } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedFull, type FullSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { loadReviewQueue, loadWorkload } = await import('./actions');

const NOW = new Date('2026-09-15T04:00:00.000Z');
const HR_ID = 'seed_hr';

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  // The minimal cast has no admin_hr (seed.ts says to add one explicitly when a test needs it).
  await db.insert(user).values({
    id: HR_ID,
    name: 'Seed HR',
    email: 'hr@test.local',
    role: 'admin_hr',
    emailVerified: true,
    active: true,
  });
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('loadReviewQueue — review.read', () => {
  it('lets every manager role and HR through, returning the queue', async () => {
    // seedMinimal leaves pt_seed_3 `submitted` but with no submission row, so the queue is
    // legitimately empty here — the point is the gate, not the rows.
    for (const id of [seed.superAdmin.id, seed.teamLeader.id, seed.projectManager.id, HR_ID]) {
      actAs(id);
      expect(Array.isArray(expectOk(await loadReviewQueue({})))).toBe(true);
    }
  });

  it('refuses an employee with FORBIDDEN (the `self` cell fails closed with no resource)', async () => {
    actAs(seed.employees[0].id);
    expectFail(await loadReviewQueue({}), 'FORBIDDEN');
  });

  it('rejects a malformed filter at validation, before reading anything', async () => {
    actAs(seed.projectManager.id);
    // A ZodError, not an AppError, so `actionResult` re-throws it rather than returning a
    // result — the slice's established convention (see create-project.test.ts).
    // @ts-expect-error — deliberately outside the schema's enum.
    await expect(loadReviewQueue({ sort: 'sideways' })).rejects.toThrow();
  });
});

describe('loadWorkload — role gate (no §9.6 workload row)', () => {
  it('lets SA / TL / PM / HR through, returning per-person rows', async () => {
    for (const id of [seed.superAdmin.id, seed.teamLeader.id, seed.projectManager.id, HR_ID]) {
      actAs(id);
      const rows = expectOk(await loadWorkload({}));
      // seedFull has open assigned work (e1, TL, e3), so a real result comes back.
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('refuses an employee with FORBIDDEN', async () => {
    actAs(seed.employees[0].id);
    expectFail(await loadWorkload({}), 'FORBIDDEN');
  });

  it('passes the project scope through to the query', async () => {
    actAs(seed.projectManager.id);
    const all = expectOk(await loadWorkload({}));
    const scoped = expectOk(await loadWorkload({ projectId: 'proj_seed' }));
    const total = (rows: typeof all) => rows.reduce((n, r) => n + r.openCount, 0);
    expect(total(scoped)).toBeLessThan(total(all));
  });
});
