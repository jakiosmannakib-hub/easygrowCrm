// features/employees/update-employee.test.ts
//
// Contract test for §13.1.2 `updateEmployee` (PUL-203.3).
//
// Same rig as create-employee.test.ts: the real easygrowcrm_test database, no DB mocks and no
// mocked `authorize()` (§15.8). The only stub is `auth.api.getSession`, the HTTP session
// envelope, because a vitest node run has no request carrying a cookie. `getSessionUser()`
// underneath still re-reads `role` and `active` from Postgres on every call (§16.5), so the
// authz case below is decided by an actual database row.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, user as userTable } from '../../db/schema';
import { expectFail } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { updateEmployee } = await import('./actions');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** The employee every case edits, given a full starting profile so the diff has something to compare. */
const STARTING_PROFILE = {
  name: 'Seed Employee One',
  title: 'SEO Specialist',
  department: 'Delivery',
  joinDate: '2026-01-04',
};

async function target() {
  const rows = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, seed.employees[0].id))
    .limit(1);
  return rows[0];
}

async function auditFor(userId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, userId));
}

beforeEach(async () => {
  seed = await seedMinimal();
  await db.update(userTable).set(STARTING_PROFILE).where(eq(userTable.id, seed.employees[0].id));
});

afterEach(() => {
  getSession.mockReset();
});

describe('updateEmployee (§13.1.2)', () => {
  it('writes the changed fields and audits exactly that diff', async () => {
    actAs(seed.superAdmin.id);

    // Department and join date are posted back unchanged — a real form sends the whole row.
    await updateEmployee({
      userId: seed.employees[0].id,
      name: 'Renamed Employee',
      title: 'Senior SEO Specialist',
      department: STARTING_PROFILE.department,
      joinDate: STARTING_PROFILE.joinDate,
    });

    expect(await target()).toMatchObject({
      name: 'Renamed Employee',
      title: 'Senior SEO Specialist',
      department: 'Delivery',
      joinDate: '2026-01-04',
    });

    const audit = await auditFor(seed.employees[0].id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'employee.updated',
      resourceType: 'employee',
    });

    // before/after carry ONLY what moved — not the untouched columns, and never role.
    expect(audit[0].before).toEqual({ name: 'Seed Employee One', title: 'SEO Specialist' });
    expect(audit[0].after).toEqual({ name: 'Renamed Employee', title: 'Senior SEO Specialist' });
  });

  it('cannot change role or email, even when the payload carries them', async () => {
    actAs(seed.superAdmin.id);

    const before = await target();

    await updateEmployee({
      userId: seed.employees[0].id,
      name: 'Renamed Employee',
      // Not part of §13.1.2's input; the parse strips them before the UPDATE is built.
      role: 'super_admin',
      email: 'hijacked@test.local',
    } as Parameters<typeof updateEmployee>[0]);

    const after = await target();
    expect(after.role).toBe(before.role);
    expect(after.email).toBe(before.email);
    expect(after.name).toBe('Renamed Employee');

    const audit = await auditFor(seed.employees[0].id);
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toEqual({ name: 'Seed Employee One' });
    expect(audit[0].after).toEqual({ name: 'Renamed Employee' });
  });

  it('is a no-op when nothing actually changed — no audit row', async () => {
    actAs(seed.superAdmin.id);

    const auditBefore = await db.select().from(auditLog);

    await updateEmployee({ userId: seed.employees[0].id, ...STARTING_PROFILE });

    expect(await target()).toMatchObject(STARTING_PROFILE);
    expect(await db.select().from(auditLog)).toHaveLength(auditBefore.length);
  });

  it('allows admin_hr', async () => {
    // §9.6 grants employee.update to HR, and the fixture has no HR user — promote a seeded
    // row so the decision comes from the database, as §16.5 requires.
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    await updateEmployee({ userId: seed.employees[0].id, title: 'Team Lead of SEO' });

    expect((await target()).title).toBe('Team Lead of SEO');
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    actAs(seed.employees[1].id);

    const call = () => updateEmployee({ userId: seed.employees[0].id, name: 'Renamed Employee' });

    expectFail(await call(), 'FORBIDDEN');

    // The consequence, not just the code: the row and the log are both untouched.
    expect((await target()).name).toBe(STARTING_PROFILE.name);
    expect(await auditFor(seed.employees[0].id)).toHaveLength(0);
  });

  it('rejects an unknown target with NOT_FOUND', async () => {
    actAs(seed.superAdmin.id);

    expectFail(await updateEmployee({ userId: 'usr_does_not_exist', name: 'Ghost' }), 'NOT_FOUND');
  });

  it('rejects a payload with no editable field', async () => {
    actAs(seed.superAdmin.id);

    // Still a THROW, not an ActionResult, and deliberately so (PUL-111): the empty payload
    // fails `UpdateEmployeeInput.parse`, and a ZodError is not an AppError, so `actionResult`
    // re-throws it. An empty patch is a caller bug the UI already prevents — not one of the
    // seven §13 outcomes — so it stays an unexpected error and stays redacted in production.
    await expect(updateEmployee({ userId: seed.employees[0].id })).rejects.toThrow();
  });
});
