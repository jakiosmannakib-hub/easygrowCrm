// features/attendance/queries.ts
//
// Reads for the attendance slice. No 'use server' and no writes: queries may run anywhere; only
// actions.ts writes (CLAUDE.md §2).
//
// "Today" is the local working day in `settings.timezone`, from the clock port, the same day
// `signIn` writes (`localToday`).

import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '../../db';
import { attendance, clients, dailyTasks, projectTasks, projects } from '../../db/schema';
import { clock } from '../../lib/clock';
import { localDateTime } from '../../lib/format';
import type { Executor } from '../../lib/mutation';
import { getSessionUser } from '../../lib/session';
import { getSettings } from '../settings/queries';

/**
 * The project-task statuses the sign-in prefill offers (§10.2): the work still to do. Not
 * `blocked` (waiting on something external) and nothing locked or finished.
 */
export const PREFILL_STATUSES = ['planned', 'in_progress', 'revision_required'] as const;

/** Today's local working day, `YYYY-MM-DD`, in `settings.timezone`. */
export async function localToday(exec: Executor = db): Promise<string> {
  const { timezone } = await getSettings(exec);
  return localDateTime(clock.now(), timezone).date;
}

export interface SignInPrefillRow {
  id: string;
  title: string;
  projectName: string;
  status: (typeof PREFILL_STATUSES)[number];
  dueDate: string;
  /** Due before today. */
  isOverdue: boolean;
}

/**
 * The Sign-In modal's daily-plan prefill (§10.2, §13.5.1) for the signed-in user: project
 * tasks assigned to me, status planned / in progress / needs revision, due today OR earlier
 * (overdue work is still today's work), on a live (active, not deleted) project.
 *
 * Order: overdue first, then priority (urgent first: the enum is declared low to urgent), then
 * title.
 */
export async function getSignInPrefill(): Promise<SignInPrefillRow[]> {
  const me = await getSessionUser();
  const today = await localToday();
  const overdue = lt(projectTasks.dueDate, today);

  const rows = await db
    .select({
      id: projectTasks.id,
      title: projectTasks.title,
      projectName: projects.name,
      status: projectTasks.status,
      dueDate: projectTasks.dueDate,
      isOverdue: sql<boolean>`${overdue}`,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      and(
        eq(projectTasks.assigneeId, me.id),
        inArray(projectTasks.status, [...PREFILL_STATUSES]),
        lte(projectTasks.dueDate, today),
        isNull(projectTasks.deletedAt),
        eq(projects.status, 'active'),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(overdue), desc(projectTasks.priority), asc(projectTasks.title));

  // The WHERE pins status to PREFILL_STATUSES and due_date to non-null; the casts say so.
  return rows.map((r) => ({
    ...r,
    status: r.status as SignInPrefillRow['status'],
    dueDate: r.dueDate as string,
  }));
}

export interface MyToday {
  attendance: Pick<
    typeof attendance.$inferSelect,
    'id' | 'signInAt' | 'workType' | 'late' | 'signOutAt' | 'signOutType'
  > | null;
  plan: Array<{
    id: string;
    title: string;
    status: typeof dailyTasks.$inferSelect.status;
    priority: typeof dailyTasks.$inferSelect.priority;
    projectTaskId: string | null;
    /** The linked task's project, or null for an ad-hoc row. */
    projectName: string | null;
    /** The linked project task's CURRENT status, or null for an ad-hoc row. */
    projectTaskStatus: typeof projectTasks.$inferSelect.status | null;
    /** The row's client, for an ad-hoc row's "Ad-hoc, {Client}" line. */
    clientName: string | null;
    /** A linked task that is still open and was due before today. */
    isOverdue: boolean;
  }>;
}

/** Statuses where a past due date still matters: the work is not done or waiting on review. */
const OVERDUE_RELEVANT = ['planned', 'in_progress', 'blocked', 'revision_required'] as const;

/**
 * The signed-in user's day so far: today's attendance row (or null before sign-in) and today's
 * plan rows. Deliberately small; PUL-304's `getMyTimer` builds on it.
 */
export async function getMyToday(): Promise<MyToday> {
  const me = await getSessionUser();
  const today = await localToday();

  const [day] = await db
    .select({
      id: attendance.id,
      signInAt: attendance.signInAt,
      workType: attendance.workType,
      late: attendance.late,
      signOutAt: attendance.signOutAt,
      signOutType: attendance.signOutType,
    })
    .from(attendance)
    .where(and(eq(attendance.employeeId, me.id), eq(attendance.date, today)))
    .limit(1);

  const plan = await db
    .select({
      id: dailyTasks.id,
      title: dailyTasks.title,
      status: dailyTasks.status,
      priority: dailyTasks.priority,
      projectTaskId: dailyTasks.projectTaskId,
      projectName: projects.name,
      projectTaskStatus: projectTasks.status,
      clientName: clients.name,
      isOverdue: sql<boolean>`coalesce(${and(
        lt(projectTasks.dueDate, today),
        inArray(projectTasks.status, [...OVERDUE_RELEVANT]),
      )}, false)`,
    })
    .from(dailyTasks)
    .leftJoin(projectTasks, eq(projectTasks.id, dailyTasks.projectTaskId))
    .leftJoin(projects, eq(projects.id, projectTasks.projectId))
    .leftJoin(clients, eq(clients.id, dailyTasks.clientId))
    .where(and(eq(dailyTasks.employeeId, me.id), eq(dailyTasks.date, today)))
    .orderBy(asc(dailyTasks.createdAt), asc(dailyTasks.id));

  return { attendance: day ?? null, plan };
}
