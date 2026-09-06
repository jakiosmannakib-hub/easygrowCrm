// features/auth/session-from-google.test.ts
//
// §15.4 mandatory test — "deactivated user rejected; unknown email rejected".
//
// Runs against the REAL easygrowcrm_test database, no mocks (§15.7). It exercises
// the two Better Auth databaseHooks guards directly rather than driving an OAuth
// round-trip: lib/auth.ts wires these same functions into user.create.before and
// session.create.before, so the rule under test is the one that ships.

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { guardActive, guardProvisioned } from '../../lib/auth-guards';

const UNKNOWN_EMAIL = 'nobody-not-provisioned@example.com';
const NOT_REGISTERED = 'This email is not registered with EasyGrowCrm. Contact HR.';
const DEACTIVATED = 'This account has been deactivated.';

// Unique per-case ids/emails so nothing collides with the seeded super_admin row.
const ids: string[] = [];

async function insertUser(suffix: string, active: boolean) {
  const id = `usr_test_${suffix}`;
  const email = `test-${suffix}@example.com`;
  ids.push(id);
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified, role, active)
    values (${id}, ${'Test ' + suffix}, ${email}, true, 'employee', ${active})
  `);
  return { id, email };
}

afterEach(async () => {
  if (ids.length === 0) return;
  await db.execute(sql`delete from "user" where id in ${sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`}`);
  ids.length = 0;
});

describe('sign-in guards (§9.2 provisioning, §9.5 rule 4)', () => {
  it('rejects an unknown email — provisioning is the invitation', async () => {
    await expect(guardProvisioned(UNKNOWN_EMAIL)).rejects.toMatchObject({
      message: NOT_REGISTERED,
    });
  });

  it('accepts a provisioned email', async () => {
    const { email } = await insertUser('provisioned', true);
    await expect(guardProvisioned(email)).resolves.toBeUndefined();
  });

  it('rejects a deactivated user — takes effect on the next request, not at token expiry', async () => {
    const { id } = await insertUser('deactivated', false);
    await expect(guardActive(id)).rejects.toMatchObject({ message: DEACTIVATED });
  });

  it('accepts an active user', async () => {
    const { id } = await insertUser('active', true);
    await expect(guardActive(id)).resolves.toBeUndefined();
  });
});
