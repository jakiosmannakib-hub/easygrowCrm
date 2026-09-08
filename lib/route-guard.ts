// lib/route-guard.ts — PUL-110.2
//
// SERVER ONLY. Every page component calls this as its first line.

import { notFound, redirect } from 'next/navigation';
import { AppError } from './errors';
import { canAccessRoute, type AppRoute } from './nav';
import { getSessionUser } from './session';

/**
 * Per-page server security boundary (§9.5, §14.1). Unauthenticated/deactivated → /sign-in;
 * role not permitted for this route → 404. Middleware only does a convenience redirect; THIS
 * is the boundary.
 *
 * 404 rather than 403 for a forbidden route is deliberate: a 403 confirms the page exists,
 * which tells an employee exactly which admin surfaces are there to go looking for.
 */
export async function requireRouteAccess(route: AppRoute) {
  let user: Awaited<ReturnType<typeof getSessionUser>>;

  try {
    user = await getSessionUser();
  } catch (err) {
    // Only the two "you are not a valid signed-in user" codes become a redirect. Anything
    // else is a real failure and must not be disguised as a login prompt.
    if (err instanceof AppError && (err.code === 'UNAUTHENTICATED' || err.code === 'DEACTIVATED')) {
      redirect('/sign-in');
    }
    throw err;
  }

  if (!canAccessRoute(user.role, route)) notFound();

  return user;
}
