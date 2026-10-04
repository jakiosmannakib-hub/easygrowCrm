// features/attendance/actions.ts
//
// Attendance actions (§13.5). Built to the 5-step shape from features/_example/actions.ts:
// validate → authorize → withTx → writeAudit → notify, inside the PUL-111 `actionResult`
// boundary.
//
// §13.5.1 signIn (PUL-302). Still to come: §13.5.2–3 breaks (PUL-303), §13.5.4 signOut
// (PUL-305), §13.5.5 earlySignOut (PUL-306).

'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  attendance,
  clients,
  dailyTasks,
  projectTasks,
  user as userTable,
} from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { localDateTime } from '../../lib/format';
import { withTx } from '../../lib/mutation';
import type { SignedInLateData } from '../../lib/notification-templates';
import { notify } from '../../lib/notifications';
import { writeAudit } from '../audit/write-audit';
import { getSettings, isHoliday } from '../settings/queries';
import { isLateSignIn } from './late';
import { SignInInput } from './schema';

/**
 * The project-task statuses a plan row may link to: any open status (§13.4.4's set). Wider
 * than the prefill's three on purpose: an employee may plan a `blocked` task to chase what is
 * blocking it. Locked and finished tasks (submitted, approved, completed, cancelled) may not.
 */
const LINKABLE_STATUSES = ['planned', 'in_progress', 'blocked', 'revision_required'] as const;

/** Postgres unique_violation on the named constraint, through Drizzle's "Failed query" wrapper. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | null)?.cause;
  return cause?.code === '23505' && cause.constraint === constraint;
}

/**
 * §13.5.1 `signIn`: any active user, self only (`attendance.sign_in_out`, §9.6; the EMP
 * "yes (self)" cell is an allow, and self-scoping is structural: every write uses `actor.id`).
 *
 * In one transaction: today's `attendance` row, the day's `daily_tasks` plan rows, and each
 * linked task still `planned` moved to `in_progress` (others untouched, §10.2), all audited.
 *
 * - **Today** is the local working day in `settings.timezone`, from the clock port.
 * - **Late** is `isLateSignIn` (late.ts): a work day, not a holiday, at or after grace + 1 min.
 * - **Already signed in** is caught by the `one_row_per_day` unique constraint, not a pre-read,
 *   so two racing sign-ins cannot both pass: the loser gets `CONFLICT`.
 * - **Linked rows** must name an open task assigned to me (`FORBIDDEN`, naming the row by the
 *   title the caller sent, so another person's task title never leaks). The stored title is the
 *   task's own.
 *
 * Notify (after commit): `N:signed_in_late` to every active HR user, only when late.
 */
export async function signIn(input: SignInInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = SignInInput.parse(input);

    const linkedIds = parsed.plan.flatMap((r) => (r.projectTaskId ? [r.projectTaskId] : []));
    if (new Set(linkedIds).size !== linkedIds.length) {
      throw new AppError('VALIDATION', 'The same task is in your plan twice.', {
        reason: 'duplicate_task',
      });
    }

    // 2. AUTHORIZE
    const actor = await authorize('attendance.sign_in_out');

    // 3. TRANSACT
    const result = await withTx(async (tx) => {
      const rules = await getSettings(tx);
      const now = clock.now();
      const local = localDateTime(now, rules.timezone);

      const late = isLateSignIn(local, rules, await isHoliday(local.date, tx));

      // Today's row first: a second sign-in fails here, before any guard can give a different
      // answer for the same plan.
      const attendanceId = `att_${crypto.randomUUID()}`;
      try {
        await tx.insert(attendance).values({
          id: attendanceId,
          employeeId: actor.id,
          date: local.date,
          workType: parsed.workType,
          signInAt: now,
          late,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (isUniqueViolation(error, 'one_row_per_day')) {
          throw new AppError('CONFLICT', "You're already signed in today.", {
            reason: 'already_signed_in',
          });
        }
        throw error;
      }

      // Linked tasks: each must be live, assigned to me, and open.
      const linked =
        linkedIds.length > 0
          ? await tx
              .select({
                id: projectTasks.id,
                title: projectTasks.title,
                assigneeId: projectTasks.assigneeId,
                status: projectTasks.status,
              })
              .from(projectTasks)
              .where(and(inArray(projectTasks.id, linkedIds), isNull(projectTasks.deletedAt)))
          : [];
      const taskById = new Map(linked.map((t) => [t.id, t]));
      for (const row of parsed.plan) {
        if (!row.projectTaskId) continue;
        const task = taskById.get(row.projectTaskId);
        if (
          !task ||
          task.assigneeId !== actor.id ||
          !(LINKABLE_STATUSES as readonly string[]).includes(task.status)
        ) {
          throw new AppError('FORBIDDEN', `"${row.title}" is not an open task assigned to you.`, {
            reason: 'task_not_plannable',
            taskId: row.projectTaskId,
          });
        }
      }

      // Clients: each named one must exist and not be archived.
      const clientIds = [...new Set(parsed.plan.flatMap((r) => (r.clientId ? [r.clientId] : [])))];
      if (clientIds.length > 0) {
        const live = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(and(inArray(clients.id, clientIds), isNull(clients.deletedAt)));
        const liveIds = new Set(live.map((c) => c.id));
        const bad = parsed.plan.find((r) => r.clientId && !liveIds.has(r.clientId));
        if (bad) {
          throw new AppError('VALIDATION', `"${bad.title}" names a client that is not active.`, {
            reason: 'inactive_client',
          });
        }
      }

      if (parsed.plan.length > 0) {
        await tx.insert(dailyTasks).values(
          parsed.plan.map((row) => ({
            id: `dt_${crypto.randomUUID()}`,
            employeeId: actor.id,
            date: local.date,
            title: row.projectTaskId ? taskById.get(row.projectTaskId)!.title : row.title,
            clientId: row.clientId ?? null,
            category: row.category ?? null,
            priority: row.priority,
            estimatedHours: row.estimatedHours !== undefined ? row.estimatedHours.toFixed(2) : null,
            expectedOutput: row.expectedOutput ?? null,
            projectTaskId: row.projectTaskId ?? null,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      // §10.2: only `planned` moves to `in_progress`; everything else is left as it is. The
      // status test is in the WHERE, so a task that moved since the read above is skipped, not
      // overwritten. Version bumps like every task status change (§11.3).
      const moved =
        linkedIds.length > 0
          ? await tx
              .update(projectTasks)
              .set({
                status: 'in_progress',
                version: sql`${projectTasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(projectTasks.id, linkedIds),
                  eq(projectTasks.status, 'planned'),
                  eq(projectTasks.assigneeId, actor.id),
                  isNull(projectTasks.deletedAt),
                ),
              )
              .returning({ id: projectTasks.id, version: projectTasks.version })
          : [];
      moved.sort((a, b) => a.id.localeCompare(b.id));

      // 4. AUDIT: same tx. One row for the sign-in, and one per moved task in the exact shape
      // `changeTaskStatusOpen` writes, so the task's history reads the same whoever moved it.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'attendance.signed_in',
        resourceType: 'attendance',
        resourceId: attendanceId,
        before: null,
        after: {
          date: local.date,
          workType: parsed.workType,
          late,
          planRows: parsed.plan.length,
          linkedTaskIds: linkedIds,
        },
      });
      for (const task of moved) {
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'project_task.status_changed',
          resourceType: 'project_task',
          resourceId: task.id,
          before: { status: 'planned', version: task.version - 1 },
          after: { status: 'in_progress', version: task.version },
        });
      }

      return {
        attendanceId,
        date: local.date,
        time: local.time,
        late,
        signInAt: now,
        movedTaskIds: moved.map((t) => t.id),
      };
    });

    // 5. NOTIFY: after commit, only when late, every active HR user (§13.5.1).
    if (result.late) {
      const [me] = await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, actor.id))
        .limit(1);
      const hr = await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(and(eq(userTable.role, 'admin_hr'), eq(userTable.active, true)));
      const data: SignedInLateData = {
        attendanceId: result.attendanceId,
        employeeId: actor.id,
        employeeName: me?.name ?? '',
        date: result.date,
        time: result.time.slice(0, 5),
      };
      for (const recipient of hr) {
        await notify({ to: recipient.id, type: 'signed_in_late', data: { ...data } });
      }
    }

    // No revalidation here: the caller re-reads with `router.refresh()` (the repo convention).
    return result;
  });
}
