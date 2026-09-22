// features/projects/queries.ts
//
// Reads for the projects slice. No 'use server' and no writes — queries may run anywhere;
// only actions.ts writes (CLAUDE.md §2).
//
// `project.read` is open to every role (§9.6), so these carry no per-row filtering. As with the
// employees and clients queries, the permission check lives at the call site (route guard / the
// consuming action), not inside the read — the PUL-207 pattern.

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { clients, projects, taskChecklistItems } from '../../db/schema';
import type { Executor } from '../../lib/mutation';

/** The columns a project picker needs. Kept narrow — the client name is for disambiguation. */
export interface PickableProject {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
}

/**
 * Every **active, non-deleted** project, name-ordered — the source for every project picker
 * and every default filter (§13.3.4: "archived projects are hidden from default dropdowns").
 *
 * Both filters live here, not in each caller, for the same reason `activeUsersQuery` filters
 * `active` and `activeClientsQuery` filters `deleted_at`: one forgotten predicate is a new task
 * silently attached to a project the agency has closed. `status='active'` and
 * `deleted_at IS NULL` are separate conditions on purpose — archiving and deleting are
 * different acts (§13.3.4 vs §13.3.5), and a deleted project is not merely an archived one.
 *
 * Joined to `clients` because two clients routinely have a project with the same name
 * ("Monthly Retainer"), and a picker showing two identical rows is unusable.
 */
export async function activeProjectsQuery(): Promise<PickableProject[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      clientId: projects.clientId,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(projects.status, 'active'), isNull(projects.deletedAt)))
    .orderBy(asc(projects.name));
}

/** The columns the project list and board header need. */
export interface ProjectRow {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'archived';
  clientId: string;
  clientName: string;
  startDate: string;
  deadline: string | null;
  createdBy: string;
}

/**
 * Every non-deleted project — **including archived ones** — name-ordered, for the admin/board
 * list (§14.3).
 *
 * The deliberate opposite of `activeProjectsQuery()` above, and the two must never be confused
 * — the same split as `activeUsersQuery` / `employeesListQuery` and `activeClientsQuery` /
 * `clientsListQuery`. A picker offering an archived project is a bug; a project *list* that
 * hides them is also a bug, because it is where a manager confirms an archive actually took and
 * where the status filter needs both sets to filter between.
 *
 * Soft-deleted rows are excluded from both queries. That is not a third view: §13.3.5's delete
 * is an erasure from the working set, not a state a manager browses.
 *
 * No pagination and no server-side filtering, for the same reason as `employeesListQuery`: the
 * agency runs tens of projects, so one unfiltered fetch is smaller than the JS that would page
 * it, and client/status/search all run in memory with no round trip.
 *
 * `startDate` and `deadline` stay `YYYY-MM-DD` strings, never `Date` — see schema.ts.
 */
export async function projectsListQuery(): Promise<ProjectRow[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      status: projects.status,
      clientId: projects.clientId,
      clientName: clients.name,
      startDate: projects.startDate,
      deadline: projects.deadline,
      createdBy: projects.createdBy,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(isNull(projects.deletedAt))
    .orderBy(asc(projects.name));
}

/**
 * Is the task's checklist complete? True when the task has NO checklist items, or every one is
 * `done` — i.e. false exactly when at least one item is still unchecked.
 *
 * **This is the predicate §13.4.6 `submitTask` (PUL-601, Phase 6) will consume as
 * `GATE:checklist_incomplete`.** It is NOT a gate itself, and no submit gate is built here —
 * PUL-405 only ships the predicate so the gate has one tested definition to call.
 *
 * Checklist only, deliberately: **subtasks never gate submission** (§9.6 ⁷, §16.8), so
 * `task_subtasks` is not read here and must never be added.
 *
 * Executor FIRST, like the slice's action helpers, so `submitTask` can pass its `tx` and decide
 * on the same snapshot it writes against.
 */
export async function checklistComplete(executor: Executor, taskId: string): Promise<boolean> {
  const [unchecked] = await executor
    .select({ id: taskChecklistItems.id })
    .from(taskChecklistItems)
    .where(and(eq(taskChecklistItems.taskId, taskId), eq(taskChecklistItems.done, false)))
    .limit(1);

  return unchecked === undefined;
}
