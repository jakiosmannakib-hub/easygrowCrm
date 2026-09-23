// features/projects/queries.ts
//
// Reads for the projects slice. No 'use server' and no writes — queries may run anywhere;
// only actions.ts writes (CLAUDE.md §2).
//
// `project.read` is open to every role (§9.6), so these carry no per-row filtering. As with the
// employees and clients queries, the permission check lives at the call site (route guard / the
// consuming action), not inside the read — the PUL-207 pattern. `getTaskDetail` is the one
// exception: it requires an authenticated, active session itself (still no per-role filter).

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import {
  clients,
  projects,
  projectTasks,
  taskChecklistItems,
  taskComments,
  taskReviews,
  taskSubmissions,
  taskSubtasks,
  user,
} from '../../db/schema';
import type { Executor } from '../../lib/mutation';
import { getSessionUser } from '../../lib/session';

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

// ─────────────────────────────────────────────────────────────────────────────────────────
// §13.8 getTaskDetail (PUL-407) — the one aggregate the Task Detail modal (§14.3.3) renders.
// ─────────────────────────────────────────────────────────────────────────────────────────

type TaskStatus = (typeof projectTasks.$inferSelect)['status'];

/** A person as the modal draws them: avatar + name. */
export interface DetailPerson {
  id: string;
  name: string;
  image: string | null;
}

/** A subtask or checklist row. */
export interface DetailChildRow {
  id: string;
  text: string;
  done: boolean;
}

export interface DetailComment {
  id: string;
  body: string;
  createdAt: Date;
  author: DetailPerson;
}

export interface DetailReview {
  decision: (typeof taskReviews.$inferSelect)['decision'];
  reviewer: { name: string };
  note: string | null;
  rating: number | null;
  metaRating: number | null;
}

export interface DetailSubmission {
  id: string;
  summary: string;
  hours: number | null;
  issues: string | null;
  proofType: (typeof taskSubmissions.$inferSelect)['proofType'];
  proofValue: string | null;
  submittedBy: { name: string };
  createdAt: Date;
  review: DetailReview | null;
}

export interface TaskDetail {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: (typeof projectTasks.$inferSelect)['priority'];
    version: number;
    /** `YYYY-MM-DD` string, never a `Date` — render with `fmtDate`. */
    dueDate: string | null;
    /** Decimal hours as numbers (render with `fmtHM`), not the driver's numeric strings. */
    estimatedHours: number | null;
    actualHours: number | null;
    qcRequired: boolean;
    proofRequired: boolean;
    description: string | null;
    sopUrl: string | null;
    expectedOutput: string | null;
    revisionNote: string | null;
    category: string;
    month: number | null;
    assigneeId: string | null;
    dependsOn: string | null;
  };
  /** `status` rides along so the modal can go read-only on an archived project (§13.3.4). */
  project: { id: string; name: string; status: (typeof projects.$inferSelect)['status'] };
  client: { name: string };
  assignee: DetailPerson | null;
  /** Position ASC. */
  subtasks: DetailChildRow[];
  /** Position ASC. */
  checklist: DetailChildRow[];
  checklistDone: number;
  checklistTotal: number;
  /** Oldest first — a conversation reads top to bottom. */
  comments: DetailComment[];
  /** Newest first. Empty until Phase 6 writes submissions; the shape is fixed now. */
  submissions: DetailSubmission[];
  /** The upstream task when `dependsOn` is set — display only (§3.2.5), never a status write. */
  dependency: { id: string; title: string; status: TaskStatus } | null;
}

/** `numeric(6,2)` arrives from the driver as a string; the UI edge (`fmtHM`) wants a number. */
function hoursOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * §13.8 `getTaskDetail` — "full task + subtasks + checklist + comments + submissions +
 * reviews": everything §14.3.3's modal renders, in one call.
 *
 * Requires an authenticated, ACTIVE user — `getSessionUser()` throws UNAUTHENTICATED /
 * DEACTIVATED otherwise. There is NO per-role filter beyond that: `project.read` is open to
 * every role (§9.6), and what each role may *do* in the modal is decided by the actions, not by
 * hiding data here. The route / call site scopes which tasks a user reaches.
 *
 * `null` when the task is missing or soft-deleted — the actions' `requireLiveTask` NOT_FOUND, as
 * a value rather than a throw because a read has no action boundary to convert it at.
 *
 * Shape notes:
 *   - `checklistDone` / `checklistTotal` are computed here, not in the view, so the `(3/5)`
 *     header and the submit-gate story read the same numbers. No subtask counts: the view can
 *     count `subtasks[]`, and nothing gates on subtasks (§9.6 ⁷).
 *   - Each submission carries its review — at most one (`one_review_per_submission`) — or
 *     `null` while it awaits one.
 *   - `dependency` is the upstream task's live status for the §3.2.5 lock. Display only: this
 *     read never writes `blocked` (or anything else) back.
 *   - Position ties (possible under concurrent adds) break on `created_at`, so the order is
 *     stable across renders.
 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  await getSessionUser();

  const [head] = await db
    .select({
      task: {
        id: projectTasks.id,
        title: projectTasks.title,
        status: projectTasks.status,
        priority: projectTasks.priority,
        version: projectTasks.version,
        dueDate: projectTasks.dueDate,
        estimatedHours: projectTasks.estimatedHours,
        actualHours: projectTasks.actualHours,
        qcRequired: projectTasks.qcRequired,
        proofRequired: projectTasks.proofRequired,
        description: projectTasks.description,
        sopUrl: projectTasks.sopUrl,
        expectedOutput: projectTasks.expectedOutput,
        revisionNote: projectTasks.revisionNote,
        category: projectTasks.category,
        month: projectTasks.month,
        assigneeId: projectTasks.assigneeId,
        dependsOn: projectTasks.dependsOn,
      },
      project: { id: projects.id, name: projects.name, status: projects.status },
      clientName: clients.name,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projectTasks.id, taskId), isNull(projectTasks.deletedAt)))
    .limit(1);

  if (!head) return null;

  const submitter = alias(user, 'submitter');
  const reviewer = alias(user, 'reviewer');
  const upstream = alias(projectTasks, 'upstream');
  const { assigneeId, dependsOn } = head.task;

  // Independent of each other once the task is known — fetched concurrently.
  const [assigneeRows, subtasks, checklist, comments, submissionRows, dependencyRows] =
    await Promise.all([
      assigneeId
        ? db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(eq(user.id, assigneeId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ id: taskSubtasks.id, text: taskSubtasks.text, done: taskSubtasks.done })
        .from(taskSubtasks)
        .where(eq(taskSubtasks.taskId, taskId))
        .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.createdAt)),
      db
        .select({
          id: taskChecklistItems.id,
          text: taskChecklistItems.text,
          done: taskChecklistItems.done,
        })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, taskId))
        .orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.createdAt)),
      db
        .select({
          id: taskComments.id,
          body: taskComments.body,
          createdAt: taskComments.createdAt,
          author: { id: user.id, name: user.name, image: user.image },
        })
        .from(taskComments)
        .innerJoin(user, eq(user.id, taskComments.authorId))
        .where(eq(taskComments.taskId, taskId))
        .orderBy(asc(taskComments.createdAt), asc(taskComments.id)),
      db
        .select({
          id: taskSubmissions.id,
          summary: taskSubmissions.summary,
          hours: taskSubmissions.hours,
          issues: taskSubmissions.issues,
          proofType: taskSubmissions.proofType,
          proofValue: taskSubmissions.proofValue,
          submittedByName: submitter.name,
          createdAt: taskSubmissions.createdAt,
          decision: taskReviews.decision,
          reviewerName: reviewer.name,
          note: taskReviews.note,
          rating: taskReviews.rating,
          metaRating: taskReviews.metaRating,
        })
        .from(taskSubmissions)
        .innerJoin(submitter, eq(submitter.id, taskSubmissions.submittedBy))
        .leftJoin(taskReviews, eq(taskReviews.submissionId, taskSubmissions.id))
        .leftJoin(reviewer, eq(reviewer.id, taskReviews.reviewerId))
        .where(eq(taskSubmissions.taskId, taskId))
        .orderBy(desc(taskSubmissions.createdAt), desc(taskSubmissions.id)),
      dependsOn
        ? db
            .select({ id: upstream.id, title: upstream.title, status: upstream.status })
            .from(upstream)
            .where(eq(upstream.id, dependsOn))
            .limit(1)
        : Promise.resolve([]),
    ]);

  return {
    task: {
      ...head.task,
      estimatedHours: hoursOrNull(head.task.estimatedHours),
      actualHours: hoursOrNull(head.task.actualHours),
    },
    project: head.project,
    client: { name: head.clientName },
    assignee: assigneeRows[0] ?? null,
    subtasks,
    checklist,
    checklistDone: checklist.filter((item) => item.done).length,
    checklistTotal: checklist.length,
    comments,
    submissions: submissionRows.map((s) => ({
      id: s.id,
      summary: s.summary,
      hours: hoursOrNull(s.hours),
      issues: s.issues,
      proofType: s.proofType,
      proofValue: s.proofValue,
      submittedBy: { name: s.submittedByName },
      createdAt: s.createdAt,
      // `decision` is NOT NULL on task_reviews, so null here means the left join found no review.
      review:
        s.decision === null
          ? null
          : {
              decision: s.decision,
              reviewer: { name: s.reviewerName ?? '' },
              note: s.note,
              rating: s.rating,
              metaRating: s.metaRating,
            },
    })),
    dependency: dependencyRows[0] ?? null,
  };
}
