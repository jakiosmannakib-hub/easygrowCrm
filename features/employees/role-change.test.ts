// features/employees/role-change.test.ts
//
// §15.4 mandatory test — "role-change.test.ts: SA only; audited". Contract test for §13.1.3
// `changeRole` (PUL-204.3).
//
// Real easygrowcrm_test database, no DB mocks and no mocked `authorize()` (§15.8). The only
// stub is `auth.api.getSession`, the HTTP session envelope, because a vitest node run has no
// request carrying a cookie. `getSessionUser()` underneath still re-reads `role` and `active`
// from Postgres on every call (§16.5) — which one case below asserts directly.
//
// The manager floor (§9.7-5) is NOT re-counted in application code: migration 0003's
// `user_min_managers` trigger evaluates it inside the UPDATE statement itself. These tests
// therefore prove the action *translates* that rejection into GATE:last_managers, and
// min-two-managers.test.ts proves the trigger holds against raw SQL.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, user as userTable } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { getSessionUser } from '../../lib/session';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { changeRole } = await import('./actions');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function roleOf(userId: string) {
  const rows = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return rows[0]?.role;
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

describe('changeRole (§13.1.3)', () => {
  it('lets a super_admin change a role, audits the before/after, and notifies the target', async () => {
    actAs(seed.superAdmin.id);
    const target = seed.employees[0].id;

    await changeRole({ userId: target, role: 'project_manager' });

    expect(await roleOf(target)).toBe('project_manager');

    const audit = await auditFor(target);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'employee.role_changed',
      resourceType: 'employee',
    });
    expect(audit[0].before).toEqual({ role: 'employee' });
    expect(audit[0].after).toEqual({ role: 'project_manager' });

    // Notified after commit (§12.4 step 5), N:role_changed → target.
    expect(__sentNotifications()).toMatchObject([
      { to: target, type: 'role_changed', data: { role: 'project_manager' } },
    ]);
  });

  it('takes effect on the target’s next request, read from the DB (§9.5 rule 4 / §16.5)', async () => {
    actAs(seed.superAdmin.id);
    const target = seed.employees[0].id;

    await changeRole({ userId: target, role: 'project_manager' });

    // A fresh request as the target: no new token, no re-login — getSessionUser() re-reads
    // role from Postgres, so the promotion is already live.
    actAs(target);
    await expect(getSessionUser()).resolves.toMatchObject({
      id: target,
      role: 'project_manager',
    });
  });

  it('denies admin_hr with FORBIDDEN and writes nothing', async () => {
    // §9.6 gives HR employee.create/update/deactivate but NOT change_role — role is the one
    // employee field only an SA moves. Promote a seeded row so the decision comes from the DB.
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    const target = seed.employees[0].id;
    await expect(changeRole({ userId: target, role: 'team_leader' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(await roleOf(target)).toBe('employee');
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    actAs(seed.employees[1].id);
    const target = seed.employees[0].id;

    const call = () => changeRole({ userId: target, role: 'team_leader' });
    await expect(call()).rejects.toBeInstanceOf(AppError);
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await roleOf(target)).toBe('employee');
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('refuses to let an SA change their own role (GATE:self_role_change)', async () => {
    actAs(seed.superAdmin.id);

    await expect(
      changeRole({ userId: seed.superAdmin.id, role: 'employee' }),
    ).rejects.toMatchObject({ code: 'GATE', reason: 'self_role_change' });

    expect(await roleOf(seed.superAdmin.id)).toBe('super_admin');
    expect(await auditFor(seed.superAdmin.id)).toHaveLength(0);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('holds the ≥2-active-managers floor (§9.7-5) — the boundary step passes, the next is GATE:last_managers', async () => {
    actAs(seed.superAdmin.id);

    // The seed has three managers (SA/TL/PM). 3 → 2 is legal and must succeed, which also
    // proves the trigger permits landing exactly on the floor.
    await changeRole({ userId: seed.projectManager.id, role: 'employee' });
    expect(await roleOf(seed.projectManager.id)).toBe('employee');

    // 2 → 1 crosses it. The trigger raises; the action reports it as a typed GATE.
    await expect(
      changeRole({ userId: seed.teamLeader.id, role: 'employee' }),
    ).rejects.toMatchObject({ code: 'GATE', reason: 'last_managers' });

    // Rejected means untouched — role and audit both.
    expect(await roleOf(seed.teamLeader.id)).toBe('team_leader');
    expect(await auditFor(seed.teamLeader.id)).toHaveLength(0);
    expect(__sentNotifications()).toHaveLength(1); // only the PM demotion notified
  });

  it('rejects an unknown target with NOT_FOUND', async () => {
    actAs(seed.superAdmin.id);

    await expect(
      changeRole({ userId: 'usr_does_not_exist', role: 'team_leader' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
