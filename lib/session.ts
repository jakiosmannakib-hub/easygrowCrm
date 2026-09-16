// lib/session.ts
//
// Corresponds to §9.5's `requireUser()`. Named `getSessionUser()` here because
// PUL-104's `authorize()` calls it by that name.
//
// §9.5 is the security boundary: middleware is only a login-redirect convenience
// (CVE-2025-29927 — header spoofing defeats middleware-only protection), never the
// boundary itself. This helper is consumed by `authorize()` at the top of every
// server action and route handler.

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '../db';
import { user as userTable } from '../db/schema';
import { auth } from './auth';
import { AppError } from './errors';

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError('UNAUTHENTICATED');

  // §9.5 rule 4 / §16.5 — DELIBERATE: `role` and `active` are re-read from the
  // database on EVERY request, never taken from the session payload.
  //
  // Do NOT cache this and do NOT read role/active off `session.user`. A single
  // primary-key read on a ~50-row table is sub-millisecond. What it buys: a
  // deactivation or role change takes effect on the person's NEXT request rather
  // than at token expiry up to 7 days later. Offboarding requires "cannot log in",
  // so a token-expiry ghost window is a bug, not an optimization.
  //
  // If caching is ever genuinely needed, the maximum acceptable is a 30–60s
  // in-memory TTL; anything longer violates the offboarding requirement.
  const rows = await db
    .select({
      id: userTable.id,
      // `name` and `image` are for display only (the PUL-113 header block). They ride along on
      // the read that already has to happen rather than in a second query, and they come from
      // the DB rather than `session.user` on purpose: an HR name edit (PUL-203) lands here on
      // the next request, where the session payload would keep the stale one until re-login.
      name: userTable.name,
      image: userTable.image,
      email: userTable.email,
      role: userTable.role,
      active: userTable.active,
    })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
    .limit(1);

  const row = rows[0];
  if (!row?.active) throw new AppError('DEACTIVATED');

  return row;
}
