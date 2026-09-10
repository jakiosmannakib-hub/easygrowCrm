// features/employees/deactivate.test.ts
//
// §15.4 mandatory test — "deactivate.test.ts: blocks if <2 managers; requires offboarding
// resolution". Contract test for §13.1.4 `deactivateEmployee` (PUL-205).
//
// Real easygrowcrm_test database, no DB mocks and no mocked `authorize()` (§15.8). The only
// stub is `auth.api.getSession`, the HTTP session envelope — a vitest node run has no request
// carrying a cookie. Everything under it stays real, including the `user_min_managers` trigger
// that decides the manager-floor case below.
//
// **Phase-2 scope note.** §13.1.4's reassignment / reroute / leave / attendance steps cannot be
// exercised yet — `project_tasks` is migration 008 (PUL-401) and `leave_requests` is 011
// (PUL-701). What is testable now is the skeleton those tickets hang off: the guards, the
// active flag, the session kill, and the audit row. PUL-401 extends this file rather than
// replacing it (§17's note on PUL-205).

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, session as sessionTable, user as userTable } from '../../db/schema';
import { clock } from '../../lib/clock';
import { expectFail } from '../../tests/expect-result';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';
import { getDeactivationBlockers } from './queries';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { deactivateEmployee } = await import('./actions');
const { getSessionUser } = await import('../../lib/session');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Give a user a live session row, the way Better Auth would on sign-in. */
async function giveSession(userId: string, token: string) {
  await db.insert(sessionTable).values({
    id: `ses_${token}`,
    token,
    userId,
    // Through the clock port even in a test fixture — §16.6 admits no exception under
    // features/**, and the rule is mechanically enforced.
    expiresAt: new Date(clock.now().getTime() + SEVEN_DAYS_MS),
  });
}

async function sessionsOf(userId: string) {
  return db.select().from(sessionTable).where(eq(sessionTable.userId, userId));
}

async function isActive(userId: string) {
  const rows = await db
    .select({ active: userTable.active })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return rows[0]?.active;
}

async function auditFor(userId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, userId));
}

beforeEach(async () => {
  seed = await seedMinimal();
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
});

describe('deactivateEmployee (§13.1.4)', () => {
  it('clears the active flag, destroys every session, and audits it in one transaction', async () => {
    const target = seed.employees[0].id;
    await giveSession(target, 'tok_laptop');
    await giveSession(target, 'tok_phone');
    // A bystander's session must survive — the DELETE is scoped to the target.
    await giveSession(seed.employees[1].id, 'tok_bystander');

    actAs(seed.superAdmin.id);
    await deactivateEmployee({ userId: target, reassignments: [], rerouted: [] });

    expect(await isActive(target)).toBe(false);
    expect(await sessionsOf(target)).toHaveLength(0);
    expect(await sessionsOf(seed.employees[1].id)).toHaveLength(1);

    const audit = await auditFor(target);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'employee.deactivated',
      resourceType: 'employee',
    });
    expect(audit[0].before).toEqual({ active: true });
    expect(audit[0].after).toEqual({ active: false });

    // Phase 2 announces nothing: the §13.1.4 notifications are for reassignment recipients.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('locks the person out on their very next request (§9.4)', async () => {
    const target = seed.employees[0].id;
    await giveSession(target, 'tok_laptop');

    actAs(seed.superAdmin.id);
    await deactivateEmployee({ userId: target, reassignments: [], rerouted: [] });

    // Even holding a cookie whose session row is gone, the DB re-read stops them:
    // getSessionUser() throws DEACTIVATED rather than returning a usable actor (§9.5 rule 4).
    actAs(target);
    await expect(getSessionUser()).rejects.toMatchObject({ code: 'DEACTIVATED' });
  });

  it('holds the ≥2-active-managers floor (§9.7-5) — boundary passes, the next is GATE:last_managers', async () => {
    actAs(seed.superAdmin.id);

    // Seed has three managers (SA/TL/PM). 3 → 2 is legal and must succeed.
    await deactivateEmployee({ userId: seed.teamLeader.id, reassignments: [], rerouted: [] });
    expect(await isActive(seed.teamLeader.id)).toBe(false);

    // 2 → 1 crosses the floor. The trigger raises; the action reports a typed GATE.
    expectFail(
      await deactivateEmployee({ userId: seed.projectManager.id, reassignments: [], rerouted: [] }),
      'GATE',
      'last_managers',
    );

    // Rejected means wholly untouched — flag and audit both rolled back.
    expect(await isActive(seed.projectManager.id)).toBe(true);
    expect(await auditFor(seed.projectManager.id)).toHaveLength(0);
  });

  it('refuses to let an actor deactivate themselves (GATE:self_deactivate)', async () => {
    actAs(seed.superAdmin.id);
    await giveSession(seed.superAdmin.id, 'tok_own');

    expectFail(
      await deactivateEmployee({ userId: seed.superAdmin.id, reassignments: [], rerouted: [] }),
      'GATE',
      'self_deactivate',
    );

    expect(await isActive(seed.superAdmin.id)).toBe(true);
    expect(await sessionsOf(seed.superAdmin.id)).toHaveLength(1);
    expect(await auditFor(seed.superAdmin.id)).toHaveLength(0);
  });

  it('allows admin_hr', async () => {
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    await deactivateEmployee({ userId: seed.employees[0].id, reassignments: [], rerouted: [] });

    expect(await isActive(seed.employees[0].id)).toBe(false);
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    const target = seed.employees[0].id;
    actAs(seed.employees[1].id);

    expectFail(
      await deactivateEmployee({ userId: target, reassignments: [], rerouted: [] }),
      'FORBIDDEN',
    );

    expect(await isActive(target)).toBe(true);
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('rejects an unknown target with NOT_FOUND', async () => {
    actAs(seed.superAdmin.id);

    expectFail(
      await deactivateEmployee({ userId: 'usr_does_not_exist', reassignments: [], rerouted: [] }),
      'NOT_FOUND',
    );
  });
});

describe('getDeactivationBlockers (§13.1.4 offboarding checklist)', () => {
  it('reports nothing to resolve before PUL-401 — there is no task table to block on', async () => {
    // Not a stub returning a convenient value: `project_tasks` is migration 008, so no
    // assignment or routed review can exist yet. The shape is final; PUL-401 fills the data.
    for (const id of [seed.superAdmin.id, seed.teamLeader.id, seed.employees[0].id]) {
      await expect(getDeactivationBlockers(id)).resolves.toEqual({
        openAssignments: [],
        routedReviews: [],
      });
    }
  });
});
