// features/employees/min-two-managers.test.ts
//
// §15.4 mandatory test — invariant §9.7-5: "at least two active manager-level users at all
// times." Enforced by the `user_min_managers` trigger from migration 0003 (§11.9's 004).
//
// Runs against the REAL easygrowcrm_test database, no mocks (§15.7). Every statement here is
// raw SQL issued straight at the table, bypassing the application layer entirely — the point
// of the ticket is that the invariant holds even for someone sitting at `psql`.
//
// Manager-level = super_admin | team_leader | project_manager (§11.1's role list in the
// trigger body). admin_hr is deliberately not in that set.
//
// Arrange note: `seedMinimal()` gives the §15.5 cast, which has THREE managers (SA/TL/PM), one
// more than the floor. So each blocking case first raw-deactivates the PM — a legal 3→2 step,
// which doubles as proof the trigger permits changes that land exactly on the boundary — and
// only then attempts the step that would cross it.

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

let seed: MinimalSeed;

/** Deactivate a user with raw SQL — no action, no authorize(), just the table. */
async function rawDeactivate(id: string) {
  await db.execute(sql`update "user" set active = false where id = ${id}`);
}

/** Change a user's role with raw SQL. */
async function rawSetRole(id: string, role: string) {
  await db.execute(
    sql`update "user" set role = ${sql.raw(`'${role}'`)}::user_role where id = ${id}`,
  );
}

/**
 * Drizzle wraps a driver failure in its own "Failed query" error and keeps the Postgres error
 * as `cause`, so the trigger's message has to be read from there.
 */
async function expectMinManagersRejection(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'statement was expected to be rejected by the trigger').toBeInstanceOf(Error);
  const cause = (caught as Error).cause;
  expect(String((cause as Error | undefined)?.message ?? '')).toMatch(
    /operation would leave fewer than two active manager-level users/,
  );
}

async function readUser(id: string) {
  const rows = await db.execute<{ role: string; active: boolean }>(
    sql`select role, active from "user" where id = ${id}`,
  );
  return rows.rows[0];
}

beforeEach(async () => {
  seed = await seedMinimal();
});

describe('min-two-managers trigger (§9.7-5)', () => {
  it('blocks a deactivation that would leave fewer than two active managers', async () => {
    // 3 managers → 2. Legal, and the boundary itself is allowed.
    await rawDeactivate(seed.projectManager.id);

    // 2 → 1. Must be rejected.
    await expectMinManagersRejection(() => rawDeactivate(seed.teamLeader.id));

    // The failed statement rolled back; the team leader is untouched.
    expect(await readUser(seed.teamLeader.id)).toMatchObject({ active: true });
    expect(await readUser(seed.superAdmin.id)).toMatchObject({ active: true });
  });

  it('blocks a demotion that would leave fewer than two active managers', async () => {
    await rawDeactivate(seed.projectManager.id);

    // Demoting the super admin drops the manager count to 1. Must be rejected.
    await expectMinManagersRejection(() => rawSetRole(seed.superAdmin.id, 'employee'));

    expect(await readUser(seed.superAdmin.id)).toMatchObject({
      role: 'super_admin',
      active: true,
    });
  });

  it('allows a change that keeps at least two active managers', async () => {
    // Promotion fires the same trigger (UPDATE OF role) and passes — so the two cases above
    // are proof the trigger REJECTED them, not proof it never ran.
    await rawSetRole(seed.employees[0].id, 'project_manager');

    expect(await readUser(seed.employees[0].id)).toMatchObject({
      role: 'project_manager',
      active: true,
    });
  });
});
