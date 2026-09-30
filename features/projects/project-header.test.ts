// features/projects/project-header.test.ts — PUL-408.2
//
// §14.3's project header: the §3.1 progress math, the §3.1.3 health thresholds, and §11.2's
// derived `currentMonth`. Not a §15.4 mandatory file (the manifest is unchanged), but squarely
// §15.2's "rules that silently break the business if wrong" — a health chip that reads On Track
// while four tasks are overdue is worse than no chip, because a manager acts on it.
//
// Two lanes in one file, deliberately: the pure helpers are swept exhaustively with no database
// (the formulas are the thing being pinned, and they are transcriptions of the PRD), and then
// `getProjectHeader` is exercised against the real easygrowcrm_test database to prove the SQL
// counting feeds those helpers the numbers they expect. Testing only the helpers would leave
// the `count(*) filter (...)` predicates — where the actual mistakes live — unasserted.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { projects, projectTasks } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';
import { progressPct, projectHealth, retainerMonth } from './display';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { getProjectHeader } = await import('./queries');

/** 2026-09-15 in Asia/Dhaka (UTC+6) — 04:00Z is 10:00 local, safely inside the day. */
const NOW = new Date('2026-09-15T04:00:00.000Z');
const TODAY = '2026-09-15';

let seed: MinimalSeed;

beforeEach(async () => {
  seed = await seedMinimal();
  setClock(createTestClock(NOW));
  getSession.mockResolvedValue({ user: { id: seed.employees[1].id } });
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The pure formulas — no database
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('projectHealth — §3.1.3 thresholds, transcribed', () => {
  it('is Critical at 4+ overdue', () => {
    expect(projectHealth(4, 0)).toBe('critical');
    expect(projectHealth(99, 0)).toBe('critical');
  });

  it('is Delayed at 2–3 overdue', () => {
    expect(projectHealth(2, 0)).toBe('delayed');
    expect(projectHealth(3, 0)).toBe('delayed');
  });

  it('is At Risk at exactly 1 overdue', () => {
    expect(projectHealth(1, 0)).toBe('at_risk');
  });

  it('is At Risk at 3+ awaiting review even with nothing overdue', () => {
    expect(projectHealth(0, 3)).toBe('at_risk');
    expect(projectHealth(0, 50)).toBe('at_risk');
  });

  it('is On Track with 0 overdue and fewer than 3 awaiting review', () => {
    expect(projectHealth(0, 0)).toBe('on_track');
    expect(projectHealth(0, 2)).toBe('on_track');
  });

  it('lets the overdue branches win over waiting_review — the order is load-bearing', () => {
    // §3.1.3 is an if/elif chain, not independent tests. A project with 5 overdue AND 4
    // awaiting review is Critical; evaluating the `waiting_review >= 3` arm first would
    // report At Risk and understate a project that is on fire.
    expect(projectHealth(5, 4)).toBe('critical');
    expect(projectHealth(2, 9)).toBe('delayed');
    expect(projectHealth(1, 9)).toBe('at_risk');
  });

  it('never returns a fifth state across a wide sweep of inputs', () => {
    const allowed = new Set(['on_track', 'at_risk', 'delayed', 'critical']);
    for (let overdue = 0; overdue <= 8; overdue++) {
      for (let waiting = 0; waiting <= 8; waiting++) {
        expect(allowed.has(projectHealth(overdue, waiting)), `${overdue}/${waiting}`).toBe(true);
      }
    }
  });
});

describe('progressPct — §3.1 / §14.3', () => {
  it('matches §14.3’s own worked example, 9/21 → 43%', () => {
    // 9/21 is 42.857…, so this pins ROUNDING rather than truncation — truncating prints 42%
    // and would silently disagree with the spec's printed example.
    expect(progressPct(9, 21)).toBe(43);
  });

  it('is 0 for an empty project rather than NaN', () => {
    expect(progressPct(0, 0)).toBe(0);
  });

  it('is 100 only when everything countable is done', () => {
    expect(progressPct(5, 5)).toBe(100);
    expect(progressPct(4, 5)).toBe(80);
  });
});

describe('retainerMonth — §11.2 derived currentMonth', () => {
  it('counts Month 1 as the start month', () => {
    expect(retainerMonth('2026-09-01', '2026-09-01')).toBe(1);
    expect(retainerMonth('2026-09-01', '2026-09-30')).toBe(1);
  });

  it('advances on the start DAY, not the 1st of the month', () => {
    // A project starting Jan 15 is in Month 1 until Feb 14 and enters Month 2 on Feb 15 —
    // §13.8's anchor ("Month k start = startDate + (k−1) calendar months").
    expect(retainerMonth('2026-01-15', '2026-02-14')).toBe(1);
    expect(retainerMonth('2026-01-15', '2026-02-15')).toBe(2);
    expect(retainerMonth('2026-01-15', '2026-03-15')).toBe(3);
  });

  it('day-clamps a start date with no counterpart in a short month', () => {
    // Jan 31 has no Feb 31. Month 2 begins on Feb 28, and comparing against the raw start day
    // would strand the project in Month 1 for all of February and then jump it to Month 3.
    expect(retainerMonth('2026-01-31', '2026-02-27')).toBe(1);
    expect(retainerMonth('2026-01-31', '2026-02-28')).toBe(2);
    expect(retainerMonth('2026-03-01', '2026-03-01')).toBe(1);
  });

  it('handles the leap-year clamp', () => {
    // 2028 is a leap year, so Feb 29 exists and is the anchor.
    expect(retainerMonth('2028-01-31', '2028-02-28')).toBe(1);
    expect(retainerMonth('2028-01-31', '2028-02-29')).toBe(2);
  });

  it('crosses year boundaries', () => {
    expect(retainerMonth('2026-11-10', '2027-02-10')).toBe(4);
    expect(retainerMonth('2026-11-10', '2027-11-10')).toBe(13);
  });

  it('clamps to Month 1 for a project that has not started yet', () => {
    // "Month 0" and "Month -2" are not things the §14.3 crumb can render.
    expect(retainerMonth('2026-12-01', '2026-09-15')).toBe(1);
    expect(retainerMonth('2027-06-01', '2026-01-01')).toBe(1);
  });

  it('never returns 0, so the Onboarding month (Month 0) is never the "Current cycle" (PUL-419)', () => {
    // Onboarding runs from the start date alongside Month 1; the cycle on that day is Month 1.
    for (const today of ['2026-08-31', '2026-09-01', '2026-09-15']) {
      expect(retainerMonth('2026-09-01', today)).not.toBe(0);
    }
    expect(retainerMonth('2026-09-01', '2026-09-01')).toBe(1);
  });

  it('degrades to Month 1 on a malformed date rather than guessing', () => {
    expect(retainerMonth('not-a-date', TODAY)).toBe(1);
    expect(retainerMonth('2026-01-01', '')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// getProjectHeader — the SQL that feeds those formulas
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Overwrite the three seeded tasks' statuses in one go. */
async function setStatuses(...statuses: Array<(typeof projectTasks.$inferSelect)['status']>) {
  await Promise.all(
    statuses.map((status, i) =>
      db
        .update(projectTasks)
        .set({ status })
        .where(eq(projectTasks.id, `pt_seed_${i + 1}`)),
    ),
  );
}

describe('getProjectHeader', () => {
  it('returns the breadcrumb parts and the derived month', async () => {
    // The fixture project starts 2026-01-01; the frozen clock is 2026-09-15 → Month 9.
    const header = await getProjectHeader(seed.project.id);

    expect(header).toMatchObject({
      id: seed.project.id,
      name: 'Seed Retainer',
      type: 'Retainer',
      status: 'active',
      client: { name: 'Seed Client' },
      // Amendment M: the breadcrumb's middle crumb (PUL-417.4).
      account: { name: 'Seed Account' },
      currentMonth: 9,
    });
  });

  it('counts `approved` and `completed` alike as done (§4.1)', async () => {
    await setStatuses('approved', 'completed', 'in_progress');

    expect((await getProjectHeader(seed.project.id))?.progress).toEqual({
      done: 2,
      total: 3,
      pct: 67,
    });
  });

  it('excludes cancelled tasks from the denominator (§4.1 / §4.2)', async () => {
    await setStatuses('approved', 'cancelled', 'in_progress');

    // 1 done of 2 countable — NOT 1 of 3. A project that cut scope must not look behind
    // forever because of work nobody is going to do.
    expect((await getProjectHeader(seed.project.id))?.progress).toEqual({
      done: 1,
      total: 2,
      pct: 50,
    });
  });

  it('excludes soft-deleted tasks from every count', async () => {
    await setStatuses('approved', 'in_progress', 'in_progress');
    await db.update(projectTasks).set({ deletedAt: NOW }).where(eq(projectTasks.id, 'pt_seed_3'));

    expect((await getProjectHeader(seed.project.id))?.progress).toEqual({
      done: 1,
      total: 2,
      pct: 50,
    });
  });

  it('is 0/0 · 0% for a project with no tasks', async () => {
    await db.delete(projectTasks).where(eq(projectTasks.projectId, seed.project.id));

    expect((await getProjectHeader(seed.project.id))?.progress).toEqual({
      done: 0,
      total: 0,
      pct: 0,
    });
  });

  it('counts overdue over OPEN tasks only, against the Dhaka clock', async () => {
    await setStatuses('in_progress', 'in_progress', 'in_progress');
    // Two overdue → Delayed.
    await db
      .update(projectTasks)
      .set({ dueDate: '2026-09-14' })
      .where(eq(projectTasks.id, 'pt_seed_1'));
    await db
      .update(projectTasks)
      .set({ dueDate: '2026-01-01' })
      .where(eq(projectTasks.id, 'pt_seed_2'));

    expect((await getProjectHeader(seed.project.id))?.health).toBe('delayed');

    // Closing one of them drops it out of the open pool → back to a single overdue, At Risk.
    await db
      .update(projectTasks)
      .set({ status: 'approved' })
      .where(eq(projectTasks.id, 'pt_seed_1'));
    expect((await getProjectHeader(seed.project.id))?.health).toBe('at_risk');

    // Cancelling the other clears the last one → On Track.
    await db
      .update(projectTasks)
      .set({ status: 'cancelled' })
      .where(eq(projectTasks.id, 'pt_seed_2'));
    expect((await getProjectHeader(seed.project.id))?.health).toBe('on_track');
  });

  it('treats today as not overdue — the comparison is strictly `<`', async () => {
    await setStatuses('in_progress', 'in_progress', 'in_progress');
    await db.update(projectTasks).set({ dueDate: TODAY }).where(eq(projectTasks.id, 'pt_seed_1'));

    expect((await getProjectHeader(seed.project.id))?.health).toBe('on_track');
  });

  it('reaches At Risk on 3 tasks awaiting review with nothing overdue', async () => {
    await setStatuses('submitted', 'submitted', 'submitted');

    expect((await getProjectHeader(seed.project.id))?.health).toBe('at_risk');
  });

  it('ignores tasks belonging to another project', async () => {
    await db.insert(projects).values({
      id: 'proj_other',
      accountId: seed.account.id,
      name: 'Other',
      type: 'One-off',
      startDate: '2026-01-01',
      createdBy: seed.projectManager.id,
    });
    await db.insert(projectTasks).values({
      id: 'pt_other',
      projectId: 'proj_other',
      category: 'Content',
      title: 'Elsewhere',
      status: 'planned',
      priority: 'medium',
      dueDate: '2020-01-01', // wildly overdue, and must not touch the seed project's health
      createdBy: seed.projectManager.id,
    });

    expect((await getProjectHeader(seed.project.id))?.health).toBe('on_track');
    expect((await getProjectHeader(seed.project.id))?.progress.total).toBe(3);
  });

  it('still returns a header for an ARCHIVED project, carrying its status', async () => {
    // The board hides an archived project's tasks, but a manager must be able to see what they
    // archived — and the UI needs `status` to hide the write affordances.
    await db
      .update(projects)
      .set({ status: 'archived' })
      .where(eq(projects.id, seed.project.id));

    expect(await getProjectHeader(seed.project.id)).toMatchObject({ status: 'archived' });
  });

  it('returns null for a missing or soft-deleted project', async () => {
    expect(await getProjectHeader('proj_nope')).toBeNull();

    await db.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, seed.project.id));
    expect(await getProjectHeader(seed.project.id)).toBeNull();
  });

  it('requires an authenticated, active user', async () => {
    getSession.mockResolvedValue(null);
    await expect(getProjectHeader(seed.project.id)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
