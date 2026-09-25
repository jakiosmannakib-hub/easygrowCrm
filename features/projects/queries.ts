// features/projects/queries.ts
//
// Reads for the projects slice. No 'use server' and no writes — queries may run anywhere;
// only actions.ts writes (CLAUDE.md §2).
//
// `project.read` is open to every role (§9.6), so these carry no per-row filtering. As with the
// employees and clients queries, the permission check lives at the call site (route guard / the
// consuming action), not inside the read — the PUL-207 pattern. `getTaskDetail` is the one
// exception: it requires an authenticated, active session itself (still no per-role filter).
// `getReviewQueue` (PUL-412) is the other: `review.read` is NOT open (EMP = own submissions
// only, §9.6), so that query applies the row scope itself. See its docblock.

import {
  and,
  asc,
  between,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
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
import { can } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { Executor } from '../../lib/mutation';
import { getSessionUser } from '../../lib/session';
import { dhakaToday } from '../../lib/format';
import {
  DEPENDENCY_SATISFIED_STATUSES,
  progressPct,
  projectHealth,
  retainerMonth,
  type ProjectHealth,
} from './display';

/** The columns a project picker needs. Kept narrow — the client name is for disambiguation. */
export interface PickableProject {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  /**
   * `YYYY-MM-DD`, never a `Date` (§11.0 — a bare `date` column is an Asia/Dhaka calendar day).
   *
   * Here because Month ▾ labels are calendar-anchored to it (§14.3 / `monthLabel`): "Month 3"
   * is only a name once you know which month the project started in. A picker row is the
   * natural carrier — the alternative is a second round trip to learn one column about a
   * project the client already has in hand.
   */
  startDate: string;
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
      startDate: projects.startDate,
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// getFilteredTasks — the one filtered-tasks read every tab shares (PUL-408.3, §14.3)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The §14.3 filter bar as a value: Client ▾ · Project ▾ · Month ▾ · Assignee ▾.
 *
 * Every key is optional and every key has an explicit "no filter" value, because the filter
 * bar's state object declares all four upfront (§16.10) and passes them through verbatim.
 * `'all'` and `undefined` mean the same thing here on purpose: the UI never has to decide
 * whether to omit a key, which is exactly the lazy-init branch §16.10 exists to prevent.
 */
export interface TaskFilters {
  clientId?: string;
  projectId?: string;
  /** A retainer month number, or `'all'`. Tasks with `month IS NULL` appear only under `'all'`. */
  month?: number | 'all';
  /** A user id, `'unassigned'` (assignee_id IS NULL), or `'all'`. */
  assigneeId?: string | 'unassigned' | 'all';
}

/** The "no filter" sentinel shared by Month ▾ and Assignee ▾. */
export const FILTER_ALL = 'all';
/** Assignee ▾'s "show claimable work" option. Not a user id — no user id can collide with it. */
export const FILTER_UNASSIGNED = 'unassigned';

/**
 * One task as a Board card / List row / Calendar chip draws it.
 *
 * **This is a LIST shape and must stay one.** No description, no comments, no submissions —
 * those are `getTaskDetail`'s job, fetched when the modal opens. A board renders every task in
 * a project at once, so anything added here is paid for N times for something nobody can read
 * without clicking through.
 */
export interface FilteredTaskRow {
  id: string;
  title: string;
  category: string;
  /** NULL for one-off (non-retainer) work (§11.3). */
  month: number | null;
  priority: (typeof projectTasks.$inferSelect)['priority'];
  status: TaskStatus;
  /** `YYYY-MM-DD` string, never a `Date` — render with `fmtDate` (§14.15 r.2). */
  dueDate: string | null;
  /**
   * Decimal hours, or `null` when unestimated — the List view's Est column (§14.3.4, PUL-410).
   * `numeric` arrives from pg as a string; converted with `hoursOrNull` like `getTaskDetail`.
   * Render with `fmtHM`, never raw.
   */
  estimatedHours: number | null;
  assignee: DetailPerson | null;
  /** For §14.3.1's subtask badge, which hides itself at `subtaskTotal === 0`. */
  subtaskDone: number;
  subtaskTotal: number;
  /**
   * §3.2.5's display-only lock: this task has an upstream dependency that is not finished.
   * The stored `status` is untouched — the pill decides to draw a padlock, nothing writes
   * `blocked` back.
   */
  dependencyBlocked: boolean;
  /**
   * The upstream task's title when `dependencyBlocked`, else `null` — for the List view's inline
   * status pill, whose tooltip names the blocking task (§14.3.2). Comes off the SAME upstream
   * join as `dependencyBlocked`, so the two cannot disagree about whether a task is blocked.
   */
  blockedByTitle: string | null;
  /**
   * The optimistic-lock version (§13.4.4 / §13.4.5). The List view's inline status control
   * sends it with every status write; `getTaskDetail` carries the same column for the modal.
   */
  version: number;
}

/**
 * §14.3 / PUL-408.3 — THE canonical filtered-tasks query. Board, List and Calendar all read
 * through this one function, which is the whole point: "filter changes update every tab
 * identically" is only true if there is one query to change (§16.9's three-surfaces-one-query
 * argument, applied to the board the same way §13.8 applies it to the review queue).
 *
 * Follows the slice's convention: `getSessionUser()` to require an authenticated, ACTIVE user,
 * and no per-role row filtering beyond that — `project.read` is open to every role (§9.6) and
 * §13.8 states the open read model explicitly ("all roles read all active projects"). What a
 * role may *do* with a task is decided by the actions; the Assignee ▾ dropdown narrowing itself
 * for employees is a convenience in the picker, not a scope on this read.
 *
 * Three exclusions are applied unconditionally, and each is a decision worth naming:
 *
 *   1. **Soft-deleted tasks** (`deleted_at`) — deletion is an erasure from the working set, not
 *      a state anyone browses. Same rule as every other read in this file.
 *   2. **Tasks on an archived or soft-deleted project** — §13.3.4: archived projects are hidden
 *      from default views. `projectsListQuery` is the deliberate opposite (a manager confirming
 *      an archive took), and this is not that surface.
 *   3. **`completed` and `cancelled` tasks — FLAGGED DECISION.** Both are terminal, and the
 *      board shows active work. Note `approved` is deliberately NOT excluded: it is the normal
 *      end of the QC path and a manager needs to see this month's approved work sitting in its
 *      column. The consequence to know about is that a `completed` task vanishes from every tab
 *      with no "show closed" affordance in this ticket — if PUL-409/410 turns out to need one,
 *      it belongs here as an `includeTerminal?: boolean` filter key, not as a second query.
 *
 * Ordering is fully stable — priority DESC (the pgEnum is declared low→urgent, so DESC is
 * urgent-first), then due date ASC with NULLs last (an undated task is not more urgent than a
 * dated one), then `created_at`, then `id` to break the remaining ties. Without that last
 * column two tasks created in the same transaction could swap places between renders.
 */
export async function getFilteredTasks(filters: TaskFilters = {}): Promise<FilteredTaskRow[]> {
  await getSessionUser();

  const upstream = alias(projectTasks, 'upstream_task');

  /*
   * Subtask counts as a grouped subquery rather than a join onto the rows themselves: joining
   * `task_subtasks` directly would multiply every task row by its subtask count and force a
   * GROUP BY over the whole select list. LEFT JOIN, so a task with no subtasks survives — its
   * counts arrive NULL and are coalesced to 0 below.
   */
  const subtaskCounts = db
    .select({
      taskId: taskSubtasks.taskId,
      total: sql<number>`count(*)::int`.as('subtask_total'),
      done: sql<number>`count(*) filter (where ${taskSubtasks.done})::int`.as('subtask_done'),
    })
    .from(taskSubtasks)
    .groupBy(taskSubtasks.taskId)
    .as('subtask_counts');

  /** One source of truth for "the upstream work is finished" — shared with the status pill. */
  const satisfied = sql.join(
    DEPENDENCY_SATISFIED_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );

  const where: SQL[] = [
    isNull(projectTasks.deletedAt),
    isNull(projects.deletedAt),
    eq(projects.status, 'active'),
    notInArray(projectTasks.status, ['completed', 'cancelled']),
  ];

  if (filters.clientId) where.push(eq(projects.clientId, filters.clientId));
  if (filters.projectId) where.push(eq(projectTasks.projectId, filters.projectId));

  // `typeof === 'number'` rather than a truthiness check: month 0 is not a valid retainer month
  // today, but a truthy test would silently drop it if that ever changed, and `'all'` is a
  // string. The three cases are spelled out so none of them falls through by accident.
  if (typeof filters.month === 'number') where.push(eq(projectTasks.month, filters.month));

  if (filters.assigneeId === FILTER_UNASSIGNED) {
    where.push(isNull(projectTasks.assigneeId));
  } else if (filters.assigneeId && filters.assigneeId !== FILTER_ALL) {
    where.push(eq(projectTasks.assigneeId, filters.assigneeId));
  }

  const rows = await db
    .select({
      id: projectTasks.id,
      title: projectTasks.title,
      category: projectTasks.category,
      month: projectTasks.month,
      priority: projectTasks.priority,
      status: projectTasks.status,
      dueDate: projectTasks.dueDate,
      estimatedHours: projectTasks.estimatedHours,
      assigneeId: user.id,
      assigneeName: user.name,
      assigneeImage: user.image,
      subtaskTotal: sql<number>`coalesce(${subtaskCounts.total}, 0)`,
      subtaskDone: sql<number>`coalesce(${subtaskCounts.done}, 0)`,
      // `coalesce(…, true)` covers the unreachable-upstream case: `depends_on` is a real FK, so
      // the row always exists, but if the join ever yields NULL we report blocked rather than
      // claim a dependency we could not read is satisfied.
      dependencyBlocked: sql<boolean>`(
        ${projectTasks.dependsOn} is not null
        and coalesce(${upstream.status}::text not in (${satisfied}), true)
      )`,
      // The upstream title, read off the same join. Paired with `dependencyBlocked` in the map
      // below rather than in SQL, so the "is it blocked" predicate exists exactly once.
      upstreamTitle: upstream.title,
      version: projectTasks.version,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .leftJoin(user, eq(user.id, projectTasks.assigneeId))
    .leftJoin(subtaskCounts, eq(subtaskCounts.taskId, projectTasks.id))
    .leftJoin(upstream, eq(upstream.id, projectTasks.dependsOn))
    .where(and(...where))
    .orderBy(
      desc(projectTasks.priority),
      sql`${projectTasks.dueDate} asc nulls last`,
      asc(projectTasks.createdAt),
      asc(projectTasks.id),
    );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    month: row.month,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    estimatedHours: hoursOrNull(row.estimatedHours),
    // The LEFT JOIN gives three NULL columns for an unassigned task; `assignee` is one nullable
    // object rather than three nullable fields so no caller can render half a person.
    assignee:
      row.assigneeId === null
        ? null
        : { id: row.assigneeId, name: row.assigneeName ?? '', image: row.assigneeImage },
    subtaskDone: Number(row.subtaskDone),
    subtaskTotal: Number(row.subtaskTotal),
    dependencyBlocked: row.dependencyBlocked,
    // Only when blocked: a satisfied dependency names nothing, so the pill draws no tooltip.
    blockedByTitle: row.dependencyBlocked ? row.upstreamTitle : null,
    version: row.version,
  }));
}

/** One project's retainer month numbers, ascending — the raw material for Month ▾. */
export interface ProjectMonths {
  projectId: string;
  /** Distinct non-null `project_tasks.month` values, ascending. */
  months: number[];
}

/**
 * Which months each active project actually has tasks in (PUL-408.2's Month ▾ cascade).
 *
 * **The month SET comes from the tasks; only the month LABEL comes from `start_date`** (see
 * `monthLabel` in display.ts). There is no stored "how many months is this retainer", and
 * inventing one — say, months elapsed since `start_date` — would offer a manager Month 7 on a
 * project whose tasks stop at Month 3, and hide Month 9 on one that was planned ahead. The
 * tasks are the only honest answer to "which cycles exist here".
 *
 * `month IS NULL` (one-off work) contributes nothing: those tasks are reachable under "All
 * months" and have no cycle to name.
 *
 * Every active project in one round trip rather than a query per selection, the same reasoning
 * as `activeProjectsQuery`: the agency runs tens of projects, so the whole cascade map is
 * smaller than the round trips that would fetch it a slice at a time, and changing the Client ▾
 * or Project ▾ costs nothing.
 */
export async function projectMonthsQuery(): Promise<ProjectMonths[]> {
  const rows = await db
    .selectDistinct({ projectId: projectTasks.projectId, month: projectTasks.month })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      and(
        isNull(projectTasks.deletedAt),
        isNull(projects.deletedAt),
        eq(projects.status, 'active'),
        isNotNull(projectTasks.month),
      ),
    )
    .orderBy(asc(projectTasks.projectId), asc(projectTasks.month));

  const byProject = new Map<string, number[]>();
  for (const row of rows) {
    if (row.month === null) continue; // unreachable past the isNotNull, but narrows the type
    const months = byProject.get(row.projectId);
    if (months) months.push(row.month);
    else byProject.set(row.projectId, [row.month]);
  }

  return [...byProject].map(([projectId, months]) => ({ projectId, months }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// getProjectHeader — §14.3's project header (PUL-408.2)
// ─────────────────────────────────────────────────────────────────────────────────────────

export interface ProjectHeader {
  id: string;
  name: string;
  type: string;
  status: (typeof projects.$inferSelect)['status'];
  client: { name: string };
  /** §11.2's derived `currentMonth` — never stored, never incremented by anyone. */
  currentMonth: number;
  /** §3.1 / §14.3's `X/Y · N%`. */
  progress: { done: number; total: number; pct: number };
  health: ProjectHealth;
}

/**
 * §14.3's project header, computed over the **WHOLE project**.
 *
 * That is the one thing about this query that is easy to get wrong, and §14.3 calls it out
 * explicitly for the health chip — "computed over the whole project, not the filtered month".
 * It therefore takes a `projectId` and NOT a `TaskFilters`: a header that moved with the filter
 * bar would tell a manager who filtered to Month 1 that the project is On Track when Months 2–3
 * are on fire. Progress is whole-project for the same reason — `9/21` is the engagement, not
 * the current view.
 *
 * Requires an authenticated, ACTIVE user; no per-role filter beyond that (`project.read` is open
 * to every role, §9.6). `null` when the project is missing or soft-deleted — as a value rather
 * than a throw, matching `getTaskDetail`, because a read has no action boundary to convert it.
 *
 * **Archived projects still return a header.** `getFilteredTasks` hides their tasks from the
 * default board, but a manager who reaches an archived project must be able to see what they
 * archived — and `status` rides along so the UI can say so and hide the write affordances.
 *
 * The counting is done in SQL in one pass rather than by fetching the tasks and counting in JS:
 * a project's task list is the one thing here that grows without bound, and the header needs
 * four integers from it. The §3.1.3 thresholds and the §3.1 percentage are then applied by the
 * pure helpers in display.ts, so the formulas are unit-testable without a database.
 */
export async function getProjectHeader(projectId: string): Promise<ProjectHeader | null> {
  await getSessionUser();

  const [head] = await db
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      status: projects.status,
      startDate: projects.startDate,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  if (!head) return null;

  // `dhakaToday()` reads the clock port, so a frozen test clock moves "today" here too — and
  // both the overdue comparison and the month derivation use the SAME string, so they cannot
  // disagree about what day it is mid-query.
  const today = dhakaToday();

  const [counts] = await db
    .select({
      // §4.1: `approved` and `completed` are both "done", treated identically for reporting.
      done: sql<number>`count(*) filter (where ${projectTasks.status} in ('approved','completed'))::int`,
      // §4.1 / §4.2: cancelled is scope-cut and leaves the denominator entirely.
      total: sql<number>`count(*) filter (where ${projectTasks.status} <> 'cancelled')::int`,
      // §3.1.3: overdue is counted over OPEN tasks only (the block excludes completed,
      // approved and cancelled), and `due_date` is a bare date compared as a string.
      overdue: sql<number>`count(*) filter (
        where ${projectTasks.status} not in ('approved','completed','cancelled')
          and ${projectTasks.dueDate} is not null
          and ${projectTasks.dueDate} < ${today}
      )::int`,
      waitingReview: sql<number>`count(*) filter (where ${projectTasks.status} = 'submitted')::int`,
    })
    .from(projectTasks)
    .where(and(eq(projectTasks.projectId, projectId), isNull(projectTasks.deletedAt)));

  const done = Number(counts?.done ?? 0);
  const total = Number(counts?.total ?? 0);

  return {
    id: head.id,
    name: head.name,
    type: head.type,
    status: head.status,
    client: { name: head.clientName },
    currentMonth: retainerMonth(head.startDate, today),
    progress: { done, total, pct: progressPct(done, total) },
    health: projectHealth(Number(counts?.overdue ?? 0), Number(counts?.waitingReview ?? 0)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// getReviewQueue — THE canonical review query: three surfaces, one function (PUL-412.1, §16.9)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** §13.8's filters. Every key optional; omitting all of them is the agency-wide queue. */
export interface ReviewQueueFilters {
  /** The project Review tab passes its project; `/review` and the dashboard card omit it. */
  projectId?: string;
  /** §14.3.5's "Routed to me" chip: only tasks whose LATEST submission routes to the viewer. */
  routedToMe?: boolean;
  /** `'oldest'` is the dashboard card's aging view (§14.3.5); the default is newest first. */
  sort?: 'newest' | 'oldest';
}

/** One §14.3.5 row: Task · Project · Submitted by · Routed to · Summary · Hours · Proof. */
export interface ReviewQueueRow {
  taskId: string;
  taskTitle: string;
  project: { id: string; name: string };
  submittedBy: { id: string; name: string };
  /** The latest submission's `reviewer_id` — a routing HINT, not a lock (§9.7). */
  routedTo: { id: string; name: string } | null;
  summary: string;
  /** Self-reported decimal hours, or `null`. Render with `fmtHM`. */
  hours: number | null;
  proofType: (typeof taskSubmissions.$inferSelect)['proofType'];
  proofValue: string | null;
  /** The latest submission's `created_at` — what "newest" / "oldest" sort on. */
  submittedAt: Date;
  /** The TASK's optimistic-lock version, for the PUL-602 review decision. */
  version: number;
}

/**
 * §13.8 `getReviewQueue` — **THE canonical review query** (Amendment F, §16.9). Three surfaces
 * call this one function, and none of them may grow a variant:
 *
 *   - the project **Review tab** (PUL-412)        → `{ projectId }`
 *   - the standalone **`/review` page** (PUL-607) → `{}`, agency-wide
 *   - the **dashboard card** (PUL-803)            → `{ sort: 'oldest' }`
 *
 * "Same filters, same rows" across those surfaces is the whole point, and it is only true if
 * there is one query to change. `review-queue.test.ts` proves it (412.4): the project-scoped
 * result is exactly the project's slice of the agency-wide one, row for row.
 *
 * **Base set:** `project_tasks.status = 'submitted'`, not soft-deleted, on an active,
 * non-deleted project. Each task is joined to its **latest** `task_submissions` row, because a
 * task that went round the revision loop has several and only the newest is under review; the
 * summary, hours, proof and routing hint all come from it. A `submitted` task with no
 * submission row at all (impossible through `submitTask`, PUL-601) is left out: there is
 * nothing to review.
 *
 * **Role scope is applied HERE, not at the call site — the one exception to this file's
 * header.** Every other read in this slice is `project.read`, which is open to all, so the gate
 * lives with the caller. `review.read` is not open: §9.6 gives managers and HR every row and an
 * employee **only their own** (`'self'`). That is a row filter, not a yes/no gate, so it belongs
 * in the one query all three surfaces share, where no caller can forget it. The Review tab and
 * `/review` are also gated to MGR/HR by route and tab visibility (§14.3), so in practice an
 * employee never reaches this; the scope is defense in depth.
 */
export async function getReviewQueue(filters: ReviewQueueFilters = {}): Promise<ReviewQueueRow[]> {
  const viewer = await getSessionUser();

  const submitter = alias(user, 'submitter');
  const routedTo = alias(user, 'routed_to');

  /*
   * The latest submission per task: `DISTINCT ON (task_id)` over newest-first rows. `id` breaks
   * the tie when two submissions share a timestamp (same transaction), so "latest" is always
   * one well-defined row. Rides the `sub_task_idx (task_id, created_at desc)` index.
   */
  const latest = db
    .selectDistinctOn([taskSubmissions.taskId], {
      taskId: taskSubmissions.taskId,
      submittedBy: taskSubmissions.submittedBy,
      summary: taskSubmissions.summary,
      hours: taskSubmissions.hours,
      proofType: taskSubmissions.proofType,
      proofValue: taskSubmissions.proofValue,
      reviewerId: taskSubmissions.reviewerId,
      createdAt: taskSubmissions.createdAt,
    })
    .from(taskSubmissions)
    .orderBy(taskSubmissions.taskId, desc(taskSubmissions.createdAt), desc(taskSubmissions.id))
    .as('latest_submission');

  const where: SQL[] = [
    eq(projectTasks.status, 'submitted'),
    isNull(projectTasks.deletedAt),
    isNull(projects.deletedAt),
    eq(projects.status, 'active'),
  ];

  if (filters.projectId) where.push(eq(projectTasks.projectId, filters.projectId));
  if (filters.routedToMe) where.push(eq(latest.reviewerId, viewer.id));

  // §9.6 `review.read`: `can()` with no resource is true only for the unconditional `allow`
  // cells (SA / TL / PM / HR). An employee's `'self'` cell needs an owner, so they fall through
  // to their own submissions only.
  if (!can(viewer, 'review.read')) where.push(eq(latest.submittedBy, viewer.id));

  const rows = await db
    .select({
      taskId: projectTasks.id,
      taskTitle: projectTasks.title,
      version: projectTasks.version,
      projectId: projects.id,
      projectName: projects.name,
      submittedById: submitter.id,
      submittedByName: submitter.name,
      routedToId: routedTo.id,
      routedToName: routedTo.name,
      summary: latest.summary,
      hours: latest.hours,
      proofType: latest.proofType,
      proofValue: latest.proofValue,
      submittedAt: latest.createdAt,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .innerJoin(latest, eq(latest.taskId, projectTasks.id))
    .innerJoin(submitter, eq(submitter.id, latest.submittedBy))
    .leftJoin(routedTo, eq(routedTo.id, latest.reviewerId))
    .where(and(...where))
    .orderBy(
      filters.sort === 'oldest' ? asc(latest.createdAt) : desc(latest.createdAt),
      // Stable tiebreak so two submissions in the same instant never swap between renders.
      asc(projectTasks.id),
    );

  return rows.map((row) => ({
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    project: { id: row.projectId, name: row.projectName },
    submittedBy: { id: row.submittedById, name: row.submittedByName },
    // One nullable object, never a half-built person (same rule as FilteredTaskRow.assignee).
    routedTo: row.routedToId === null ? null : { id: row.routedToId, name: row.routedToName ?? '' },
    summary: row.summary,
    hours: hoursOrNull(row.hours),
    proofType: row.proofType,
    proofValue: row.proofValue,
    submittedAt: row.submittedAt,
    version: row.version,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// getWorkload — per-person open-task capacity (PUL-412.3, §14.3.6)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Statuses that are NOT open work, for §14.3.6 ("data from open statuses only").
 *
 * Deliberately its own constant rather than `OPEN_STATUSES_FOR_HEALTH` inverted: the health
 * calc (§3.1.3) and workload answer different questions and agree by coincidence today, the
 * same reasoning that keeps `DONE_STATUSES` and `DEPENDENCY_SATISFIED_STATUSES` apart.
 */
const WORKLOAD_CLOSED_STATUSES = ['approved', 'completed', 'cancelled'] as const;

export interface WorkloadFilters {
  /**
   * Scope to one project: the Workload tab with a project selected. Omitted → agency-wide, the
   * tab with "All projects", which is the truer capacity number: a person's load is everything
   * they hold, not one engagement's share of it. Both are supported.
   */
  projectId?: string;
}

export interface WorkloadRow {
  user: { id: string; name: string; image: string | null };
  openCount: number;
  /** SUM of `estimated_hours` over the open tasks; an unestimated task adds 0. Render with `fmtHM`. */
  estHours: number;
  /**
   * §14.3.6's live on-break dot. **ALWAYS `false`: a stub.** TODO(Phase 3 / attendance): the
   * attendance and breaks tables are PUL-301, and Phase 3 was taken out of order and has not
   * been built (§17's phase-order note), so there is no data source for "on a break right now".
   * Wire this to the open-break row once PUL-303 lands. Until then the field exists so the tab's
   * shape is final and the dot becomes a data change, not a layout change.
   */
  onBreak: boolean;
}

/**
 * §13.8 `getWorkload` — per-person open task count + estimated hours (§14.3.6).
 *
 * - **Open** = every status except approved / completed / cancelled, on a non-deleted task on an
 *   active, non-deleted project (archived work is hidden from default views, §13.3.4 — the same
 *   exclusion as `getFilteredTasks`).
 * - **Dependency-blocked tasks count as open** (§3.2.5, §14.3.6). Nothing special is needed: the
 *   dependency lock is display-only and never rewrites the stored status, which is already open.
 * - **Unassigned tasks are excluded**: there is no person to attribute them to. They are visible
 *   in the Board's pinned group and the List's banner instead.
 * - **Only people holding at least one open task appear**, because the rows are grouped from
 *   tasks; an idle person is absent rather than a `0` row. A deactivated user still holding open
 *   work DOES appear — that is exactly the orphaned work a manager needs to see.
 * - Ordered by open count DESC, then name, so the most loaded person is first.
 *
 * **Access:** §13.8 says MGR + HR, but §9.6 has no workload action to authorize against, so this
 * follows the slice convention (authenticated and active via `getSessionUser()`), with the
 * MGR/HR gate on the Workload tab (§14.3) and its consuming action. Flagged in §17 / PUL-412.
 */
export async function getWorkload(filters: WorkloadFilters = {}): Promise<WorkloadRow[]> {
  await getSessionUser();

  const where: SQL[] = [
    isNotNull(projectTasks.assigneeId),
    notInArray(projectTasks.status, [...WORKLOAD_CLOSED_STATUSES]),
    isNull(projectTasks.deletedAt),
    isNull(projects.deletedAt),
    eq(projects.status, 'active'),
  ];
  if (filters.projectId) where.push(eq(projectTasks.projectId, filters.projectId));

  const openCount = sql<number>`count(*)::int`;

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      openCount,
      // A `numeric` SUM comes back as a string; unestimated tasks contribute 0, not NULL.
      estHours: sql<string>`coalesce(sum(${projectTasks.estimatedHours}), 0)`,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .innerJoin(user, eq(user.id, projectTasks.assigneeId))
    .where(and(...where))
    .groupBy(user.id, user.name, user.image)
    .orderBy(desc(openCount), asc(user.name), asc(user.id));

  return rows.map((row) => ({
    user: { id: row.id, name: row.name, image: row.image },
    openCount: Number(row.openCount),
    estHours: Number(row.estHours),
    onBreak: false, // TODO(Phase 3 / attendance): see WorkloadRow.onBreak.
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// getClientExportRows — the client-safe Weekly / Monthly Excel export (PUL-413, §13.8)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** An inclusive `YYYY-MM-DD` due-date window. The caller computes it from the clock port. */
export interface ClientExportRange {
  from: string;
  to: string;
}

/**
 * The statuses a client may see (§3.1.7 / §6.3): Completed, Approved and In Progress, and
 * nothing else. Submitted, Blocked, Cancelled and Planned are deliberately excluded.
 */
export const CLIENT_EXPORT_STATUSES = ['completed', 'approved', 'in_progress'] as const;

/**
 * One export row. **This interface is the client-safe contract, so only widen it if the field
 * belongs in something a client can read.** §3.1.7 / §6.3 rule out the assignee, priority,
 * comments and every submission note (summary, issues, reviewer), and none of them is selected
 * below.
 */
export interface ClientExportRow {
  clientId: string;
  clientName: string;
  projectName: string;
  /**
   * The project's `start_date`. It is not a printed column: `monthLabel` needs it to name the
   * retainer month (`Month 3 — March`).
   */
  projectStartDate: string;
  /** Retainer month number; NULL for one-off work. */
  month: number | null;
  title: string;
  category: string;
  /** `YYYY-MM-DD`. Never null here: the range filter only matches dated tasks. */
  dueDate: string;
  status: (typeof CLIENT_EXPORT_STATUSES)[number];
  /** `actual_hours` if set, else the latest submission's `hours` (§3.1.7), else null. */
  timeSpentHours: number | null;
  /** The latest submission's proof link, or null. Never the summary. */
  proofUrl: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * §13.8 `exportClientTasks`: the rows behind the client Excel export (PUL-413.1).
 *
 * **Filter:** `due_date BETWEEN from AND to` (inclusive), status in `CLIENT_EXPORT_STATUSES`,
 * and `client_visible = true`. Soft-deleted tasks, projects and clients are excluded, as in
 * every read in this file.
 *
 * **Archived projects are INCLUDED, and that is a decision.** `getFilteredTasks` hides them
 * because the board shows live work. This is a report of what was done in a date window, and
 * work finished last week does not disappear from the client's report because the project was
 * archived yesterday. This is also why 413.3 compares against this query rather than against
 * the board's rows (see the note under PUL-413 in §17).
 *
 * **Time spent / proof** come from the task's latest submission: the same `DISTINCT ON` as
 * `getReviewQueue`, because after a revision loop only the newest submission is current.
 *
 * **No session check inside.** The MGR gate lives at the route handler, the only caller (the
 * PUL-207 call-site pattern this file's header describes). The range is validated because a
 * malformed string reaching `BETWEEN` would be compared as text and silently return the wrong
 * rows.
 *
 * Ordered by client name, project name and due date, then `id` for a stable tie-break.
 */
export async function getClientExportRows(range: ClientExportRange): Promise<ClientExportRow[]> {
  if (!YMD.test(range.from) || !YMD.test(range.to) || range.from > range.to) {
    throw new AppError('VALIDATION', 'Export range must be YYYY-MM-DD, from ≤ to.');
  }

  const latest = db
    .selectDistinctOn([taskSubmissions.taskId], {
      taskId: taskSubmissions.taskId,
      hours: taskSubmissions.hours,
      proofValue: taskSubmissions.proofValue,
    })
    .from(taskSubmissions)
    .orderBy(taskSubmissions.taskId, desc(taskSubmissions.createdAt), desc(taskSubmissions.id))
    .as('latest_submission');

  const rows = await db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      projectName: projects.name,
      projectStartDate: projects.startDate,
      month: projectTasks.month,
      title: projectTasks.title,
      category: projectTasks.category,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      actualHours: projectTasks.actualHours,
      submissionHours: latest.hours,
      proofUrl: latest.proofValue,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(latest, eq(latest.taskId, projectTasks.id))
    .where(
      and(
        between(projectTasks.dueDate, range.from, range.to),
        inArray(projectTasks.status, [...CLIENT_EXPORT_STATUSES]),
        eq(projectTasks.clientVisible, true),
        isNull(projectTasks.deletedAt),
        isNull(projects.deletedAt),
        isNull(clients.deletedAt),
      ),
    )
    .orderBy(
      asc(clients.name),
      asc(projects.name),
      asc(projectTasks.dueDate),
      asc(projectTasks.id),
    );

  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    projectName: row.projectName,
    projectStartDate: row.projectStartDate,
    month: row.month,
    title: row.title,
    category: row.category,
    // BETWEEN never matches NULL, so this is always set. `?? ''` only narrows the type.
    dueDate: row.dueDate ?? '',
    status: row.status as ClientExportRow['status'],
    timeSpentHours: hoursOrNull(row.actualHours ?? row.submissionHours),
    proofUrl: row.proofUrl,
  }));
}
