// lib/auth-guards.ts
//
// The two Better Auth databaseHooks checks, extracted as plain functions so they
// can be contract-tested against a real database without standing up an OAuth
// round-trip (§15.7 — no mocks). lib/auth.ts wires them into the hooks; the
// behavior is identical either way.

import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { user as userTable } from '../db/schema';

/**
 * Accounts are provisioned by SA/HR — provisioning *is* the invitation (§9.2).
 * Fires from user.create.before, i.e. only for emails with no existing row,
 * so anyone not pre-provisioned is rejected here.
 */
export async function guardProvisioned(email: string): Promise<void> {
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  if (!rows[0]) {
    throw new APIError('FORBIDDEN', {
      message: 'This email is not registered with EasyGrowCrm. Contact HR.',
    });
  }
}

/**
 * Fires from session.create.before — on every sign-in, existing users included —
 * so a deactivated account cannot obtain a new session (§9.5 rule 4).
 */
export async function guardActive(userId: string): Promise<void> {
  const rows = await db
    .select({ active: userTable.active })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (!rows[0]?.active) {
    throw new APIError('FORBIDDEN', {
      message: 'This account has been deactivated.',
    });
  }
}
