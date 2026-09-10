// features/employees/reactivate.test.ts
//
// Contract test for §13.1.5 `reactivateEmployee` (PUL-206 Stage 3).
//
// §13.1.5 has no build-plan ticket of its own — §17 never allocated one — so the action was
// folded into the Employees-page ticket, and this file joins the §15.4 mandatory list with it.
// Reactivation is an accountability-bearing mutation of the same flag §13.1.4 clears, so it
// gets the same treatment: real easygrowcrm_test database, no DB mocks, no mocked
// `authorize()` (§15.8). The only stub is `auth.api.getSession`, the HTTP session envelope,
// which a vitest node run has no request to supply.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, user as userTable } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { reactivateEmployee } = await import('./actions');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function deactivate(userId: string) {
  await db.update(userTable).set({ active: false }).where(eq(userTable.id, userId));
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

describe('reactivateEmployee (§13.1.5)', () => {
  it('sets the active flag back and audits it in one transaction', async () => {
    const target = seed.employees[0].id;
    await deactivate(target);

    actAs(seed.superAdmin.id);
    await reactivateEmployee({ userId: target });

    expect(await isActive(target)).toBe(true);

    const audit = await auditFor(target);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'employee.reactivated',
      resourceType: 'employee',
    });
    expect(audit[0].before).toEqual({ active: false });
    expect(audit[0].after).toEqual({ active: true });

    // §13.1.5 lists no notification — the person is told out of band, as at provisioning.
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('is a silent no-op on an already-active user — no second audit row', async () => {
    // The audit log records what HAPPENED. A row claiming a reactivation that changed nothing
    // would put a false event on someone's history, and two admins double-clicking would
    // manufacture two of them.
    const target = seed.employees[0].id;
    expect(await isActive(target)).toBe(true);

    actAs(seed.superAdmin.id);
    await reactivateEmployee({ userId: target });

    expect(await isActive(target)).toBe(true);
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('writes exactly one audit row when called twice — the second call is the no-op', async () => {
    const target = seed.employees[0].id;
    await deactivate(target);

    actAs(seed.superAdmin.id);
    await reactivateEmployee({ userId: target });
    await reactivateEmployee({ userId: target });

    expect(await isActive(target)).toBe(true);
    expect(await auditFor(target)).toHaveLength(1);
  });

  it('allows admin_hr (§13.1.5 — SA and HR)', async () => {
    const target = seed.employees[0].id;
    await deactivate(target);

    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);

    await reactivateEmployee({ userId: target });

    expect(await isActive(target)).toBe(true);
  });

  it('denies a plain employee with FORBIDDEN and writes nothing', async () => {
    const target = seed.employees[0].id;
    await deactivate(target);

    actAs(seed.employees[1].id);

    const call = () => reactivateEmployee({ userId: target });
    await expect(call()).rejects.toBeInstanceOf(AppError);
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Mutation-proof: a denied call leaves the flag AND the log untouched. If the permission
    // cell for `employee.reactivate` is ever flipped to allow, this is what fails — not just
    // the thrown code, but the fact that a denied actor could bring an account back.
    expect(await isActive(target)).toBe(false);
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('denies a team_leader and a project_manager too (they are not people-ops)', async () => {
    const target = seed.employees[0].id;
    await deactivate(target);

    for (const actor of [seed.teamLeader.id, seed.projectManager.id]) {
      actAs(actor);
      await expect(reactivateEmployee({ userId: target })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }

    expect(await isActive(target)).toBe(false);
    expect(await auditFor(target)).toHaveLength(0);
  });

  it('rejects an unknown target with NOT_FOUND', async () => {
    actAs(seed.superAdmin.id);

    await expect(reactivateEmployee({ userId: 'usr_does_not_exist' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a malformed input before it reaches the database', async () => {
    actAs(seed.superAdmin.id);

    await expect(reactivateEmployee({ userId: '' })).rejects.toThrow();
  });
});
