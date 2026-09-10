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

/**
 * The columns the §14.12 grid and its detail drawer need. Narrower than `user` — no
 * timestamps, no auth columns.
 *
 * `joinDate` is here for the drawer's edit form (§13.1.2) rather than the card, which never
 * shows it. It is a `YYYY-MM-DD` string, not a `Date`: the column is a bare `date` (§11.0),
 * read as an Asia/Dhaka calendar day, and turning it into a `Date` anywhere in this path is
 * how it would silently shift across a day boundary.
 */
export interface EmployeeCard {
  id: string;
  name: string;
  email: string;
  role: (typeof userTable.$inferSelect)['role'];
  title: string | null;
  department: string | null;
  active: boolean;
  image: string | null;
  joinDate: string | null;
}

/**
 * Every employee — **including deactivated ones** — name-ordered, for the §14.12 grid.
 *
 * This is deliberately the opposite of `activeUsersQuery()` above, and the two must not be
 * confused: a picker offering a deactivated person is a bug, while an employee *directory*
 * that hides them is also a bug — /employees is where HR goes to confirm an offboarding
 * actually took, and the status ▾ filter needs both sets to filter between. Deactivated rows
 * render through `displayNameParts()` with the muted suffix (§14.15 r.9).
 *
 * No pagination and no server-side filtering: the org is 20–50 people (CLAUDE.md preamble),
 * so one unfiltered fetch is smaller than the JS that would page it, and dept/status/search
 * all run in memory client-side with no round trip.
 */
export async function employeesListQuery(): Promise<EmployeeCard[]> {
  return db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      role: userTable.role,
      title: userTable.title,
      department: userTable.department,
      active: userTable.active,
      image: userTable.image,
      joinDate: userTable.joinDate,
    })
    .from(userTable)
    .orderBy(asc(userTable.name));
}
