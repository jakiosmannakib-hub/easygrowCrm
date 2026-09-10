// features/employees/create-employee.test.ts
//
// §15.4 mandatory test — contract test for §13.1.1 `createEmployee`.
//
// Real easygrowcrm_test database, no DB mocks (§15.8). `authorize()` is NOT mocked either —
// that's the thing under contract. The ONLY stub is `auth.api.getSession`, the HTTP session
// envelope, because a vitest node run has no request to read a cookie from. Everything below
// it stays real: `getSessionUser()` still re-reads `role` and `active` from Postgres on every
// call (§16.5), so the authz cases below are decided by actual database rows.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, user as userTable } from '../../db/schema';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { createEmployee } = await import('./actions');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

const NEW_EMPLOYEE = {
  email: 'new.hire@test.local',
  name: 'New Hire',
  role: 'employee' as const,
  title: 'SEO Specialist',
  department: 'Delivery',
  joinDate: '2026-09-08',
};

async function findByEmail(email: string) {
  const rows = await db.select().from(userTable).where(eq(userTable.email, email)).limit(1);
  return rows[0];
}

beforeEach(async () => {
  seed = await seedMinimal();
});

afterEach(() => {
  getSession.mockReset();
});

describe('createEmployee (§13.1.1)', () => {
  it('creates an active employee row and audits it in the same transaction', async () => {
    actAs(seed.superAdmin.id);

    const created = expectOk(await createEmployee(NEW_EMPLOYEE));

    const row = await findByEmail(NEW_EMPLOYEE.email);
    expect(row).toMatchObject({
      id: created.id,
      name: 'New Hire',
      email: 'new.hire@test.local',
      role: 'employee',
      title: 'SEO Specialist',
      department: 'Delivery',
      joinDate: '2026-09-08',
      active: true,
    });

    // Provisioning is the invitation (§9.2): a user row, and no OAuth account yet.
    const accounts = await db.query.account.findMany({
      where: (a, { eq: e }) => e(a.userId, row.id),
    });
    expect(accounts).toHaveLength(0);

    const audit = await db.select().from(auditLog).where(eq(auditLog.resourceId, created.id));

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'employee.created',
      resourceType: 'employee',
      before: null,
    });
    expect(audit[0].after).toMatchObject({ email: 'new.hire@test.local', active: true });
  });

  it('rejects a duplicate email with CONFLICT and writes nothing', async () => {
    actAs(seed.superAdmin.id);

    const before = await db.select().from(userTable);
    const auditBefore = await db.select().from(auditLog);

    expectFail(
      await createEmployee({ ...NEW_EMPLOYEE, email: seed.employees[0].email }),
      'CONFLICT',
    );

    // No partial write: neither a user row nor an audit row survived the rollback.
    expect(await db.select().from(userTable)).toHaveLength(before.length);
    expect(await db.select().from(auditLog)).toHaveLength(auditBefore.length);
  });

  it('allows admin_hr', async () => {
    // The §9.6 matrix grants employee.create to HR, and the fixture has no HR user —
    // promote a seeded employee so the role comes from a real DB row, as §16.5 requires.
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[0].id));
    actAs(seed.employees[0].id);

    const created = expectOk(await createEmployee(NEW_EMPLOYEE));

    expect(await findByEmail(NEW_EMPLOYEE.email)).toMatchObject({ id: created.id });
  });

  it('denies a plain employee with FORBIDDEN', async () => {
    actAs(seed.employees[1].id);

    const auditBefore = await db.select().from(auditLog);

    expectFail(await createEmployee(NEW_EMPLOYEE), 'FORBIDDEN');

    // The consequence, not just the code: a denied caller creates no user and no audit row.
    expect(await findByEmail(NEW_EMPLOYEE.email)).toBeUndefined();
    expect(await db.select().from(auditLog)).toHaveLength(auditBefore.length);
  });
});
