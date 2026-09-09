// features/employees/queries.ts
//
// Reads for the employees slice. No 'use server' and no writes — queries may run anywhere
// (server components, other queries, actions); only actions.ts writes (CLAUDE.md §2).

import { asc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { user as userTable } from '../../db/schema';

/**
 * The offboarding checklist §13.1.4 / §9.4 requires the deactivate modal to resolve: every
 * open task assigned to the target, and every submitted task awaiting their review.
 *
 * **Shape is final; the data is not yet.** `project_tasks` is migration 008 (PUL-401), so in
 * Phase 2 there is no table to read and no assignment that could exist — both arrays are
 * necessarily empty, and the emptiness is a fact about the schema, not a stub that lies.
 *
 * PUL-401 replaces the two literals with the real reads, and nothing above this function
 * changes: `deactivateEmployee` already refuses to proceed when either array is non-empty,
 * and Stage 2's modal already renders them.
 *
 *   openAssignments — status NOT IN (approved, completed, cancelled), assignee = target
 *   routedReviews   — status = submitted, latest submission's reviewer_id = target
 */
export interface DeactivationBlockers {
  openAssignments: Array<{ taskId: string; title: string }>;
  routedReviews: Array<{ taskId: string; title: string }>;
}

export async function getDeactivationBlockers(userId: string): Promise<DeactivationBlockers> {
  void userId; // in the signature from day one; PUL-401 is what starts reading it
  return { openAssignments: [], routedReviews: [] };
}

/** The columns any assignee/reviewer picker needs. Kept narrow — no email in a dropdown. */
export interface PickableUser {
  id: string;
  name: string;
  role: (typeof userTable.$inferSelect)['role'];
  active: boolean;
}

/**
 * Every active user, name-ordered — the source for **every** assignee / reviewer / owner
 * dropdown from here on.
 *
 * A deactivated person must never be selectable for new work, and the filter belongs here
 * rather than in each caller: one forgotten `WHERE active` is a bug that silently routes a
 * task to someone who can no longer sign in. Callers that need to *display* an already-stored
 * assignment (a historical row naming someone since deactivated) render it through
 * `displayName()` instead of re-querying — see display.ts.
 *
 * Note this deliberately does NOT exclude `super_admin`: SA is barred from being a *task
 * assignee* (§9.7-4, enforced by trigger and app check at PUL-401), but is a legitimate
 * choice in other pickers. The assignee picker filters SA at its own call site.
 */
export async function activeUsersQuery(): Promise<PickableUser[]> {
  return db
    .select({
      id: userTable.id,
      name: userTable.name,
      role: userTable.role,
      active: userTable.active,
    })
    .from(userTable)
    .where(eq(userTable.active, true))
    .orderBy(asc(userTable.name));
}
