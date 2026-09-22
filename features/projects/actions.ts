// features/projects/actions.ts
//
// Project actions (§13.3). Built to the 5-step shape from features/_example/actions.ts:
// validate → authorize → withTx → writeAudit → notify, inside the PUL-111 `actionResult`
// boundary.
//
// §13.3.1 createProject · §13.3.3 updateProject · §13.3.4 archiveProject / unarchiveProject.
// §13.4.1 createTask (PUL-403 Stage 1) — the slice owns project-task actions too.
// Still to come: §13.3.5 `deleteProject` (SA only), §13.3.2 `createProjectFromTemplate`
// (PUL-506, the Start Project wizard), and §13.4.3 `assignTask` (PUL-403 Stage 2).

'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db';
import {
  clients,
  projectTasks,
  projects,
  taskChecklistItems,
  user as userTable,
} from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { withTx, type Executor } from '../../lib/mutation';
import { notify } from '../../lib/notifications';
import { writeAudit } from '../audit/write-audit';
import { MANAGER_ROLES } from '../employees/queries';
import {
  ArchiveProjectInput,
  CreateProjectInput,
  CreateTaskInput,
  UnarchiveProjectInput,
  UpdateProjectInput,
} from './schema';

/**
 * Resolve a client that a project may legally point at: it must exist AND not be archived.
 *
 * Takes the executor FIRST so callers pass their `tx` — the check and the write then share one
 * snapshot, the §17.7 #2 fix that `getClientProjectUsage` already applies. Reading against the
 * global `db` from inside `withTx` would sit outside the transaction, and a client archived in
 * between would leave a live project pointing at it.
 *
 * NOT_FOUND rather than GATE for the archived case, deliberately: from the caller's point of
 * view there is no such selectable client. `activeClientsQuery` never offers an archived one,
 * so a payload naming one is a stale form or a hand-made request, not a user who needs telling
 * which rule they hit.
 */
async function requireLiveClient(executor: Executor, clientId: string): Promise<void> {
  const [row] = await executor
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);

  if (!row) {
    throw new AppError('NOT_FOUND', 'Client not found');
  }
}

/**
 * Every active manager-level user — the `N:project_started` audience (§13.3.1 "→ all MGR").
 *
 * `MANAGER_ROLES` is imported from the employees slice rather than re-listed, so the three
 * roles this fans out to cannot drift from the set the rest of the app calls manager-level.
 * `active` is filtered for the same reason `activeUsersQuery` filters it: notifying someone
 * who can no longer sign in is noise.
 */
async function managerRecipients(): Promise<string[]> {
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(eq(userTable.active, true), inArray(userTable.role, [...MANAGER_ROLES])));

  return rows.map((r) => r.id);
}

/**
 * §13.3.1 `createProject` (manual) — MGR (`project.create`).
 *
 * Timestamps come from the clock port rather than the column defaults, so `created_at`,
 * `updated_at` and a later `deleted_at` all sit on one timeline under a frozen test clock —
 * the same reason `createClient` does it.
 *
 * `status` is left to the column default (`'active'`, §11.2) rather than written explicitly:
 * the default IS the spec, and repeating it here would create a second place to change it.
 *
 * `deadline >= start_date` is checked twice on purpose: `CreateProjectInput`'s `.refine()` so
 * the caller gets a parse error it can render, and the `deadline_after_start` CHECK constraint
 * (migration 0005) so every other writer — including SQL run by hand — is held to it too. The
 * constraint is the authority; the refine exists because a raw CHECK violation is not an
 * `AppError` and would reach the client as a redacted crash.
 *
 * Notify: `N:project_started` → all MGR (§13.3.1), enqueued AFTER the transaction commits
 * (§12.4 step 5) — a rolled-back project must not announce itself.
 */
export async function createProject(input: CreateProjectInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateProjectInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project.create');

    // 3. TRANSACT
    const row = await withTx(async (tx) => {
      // Guard and write share the transaction's snapshot.
      await requireLiveClient(tx, parsed.clientId);

      const id = `prj_${crypto.randomUUID()}`;
      const now = clock.now();

      const [created] = await tx
        .insert(projects)
        .values({
          id,
          clientId: parsed.clientId,
          name: parsed.name,
          type: parsed.type,
          startDate: parsed.startDate,
          deadline: parsed.deadline ?? null,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 4. AUDIT — same tx (§9.8 `project.created`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project.created',
        resourceType: 'project',
        resourceId: id,
        before: null,
        after: created,
      });

      return created;
    });

    // 5. NOTIFY — after commit, never inside the tx (§13.3.1 `N:project_started` → all MGR).
    const recipients = await managerRecipients();
    for (const to of recipients) {
      await notify({
        to,
        type: 'project_started',
        data: { projectId: row.id, projectName: row.name, startedBy: actor.id },
      });
    }

    return row;
  });
}

/** The only columns §13.3.3 may touch. Only `deadline` is nullable; the other three are NOT NULL. */
type ProjectEdit = {
  name?: string;
  clientId?: string;
  startDate?: string;
  deadline?: string | null;
};
type EditableField = keyof ProjectEdit;

/**
 * §13.3.3 `updateProject` — MGR (`project.update`).
 *
 * The PUL-203 diff convention, as in `updateEmployee` and `updateClient`: the UPDATE and the
 * audit row carry only the fields that actually changed, and a submit that changes nothing
 * writes nothing — no UPDATE, no `updated_at` bump, no audit row. A real form posts the whole
 * row back, so without this every "Save" would manufacture an audit event.
 *
 * **Changing `deadline` does NOT recompute task due dates** (§13.3.3). Those dates were
 * materialized when the project was instantiated from its template; moving them is a per-task
 * edit. This is the one guard §13.3.3 names, and it is a guard against doing something — so it
 * shows up here as the deliberate absence of a cascade, not as a check.
 *
 * Changing `clientId` re-runs the live-client guard: a project may not be moved onto an
 * archived client any more than it may be created on one.
 *
 * **Archived projects are content-read-only** (§13.3.4): the guard below refuses any edit to a
 * project whose `status='archived'`, before the diff is computed. Only `unarchiveProject` may
 * move such a project, and it changes `status` alone — so there is no ordering in which an
 * archived project's content can be edited without an explicit un-archive first.
 *
 * It is a GATE rather than a FORBIDDEN because the caller's *role* is fine; it is the target's
 * state that refuses, and `reason: 'project_archived'` lets the toast say so and offer the
 * un-archive path (§14.15).
 *
 * Notify: none (§13.3.3).
 */
export async function updateProject(input: UpdateProjectInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UpdateProjectInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      // Read inside the tx so the diff is computed against the row we are about to write.
      const [current] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Project not found');
      }

      // §13.3.4: archived projects are read-only everywhere. Checked BEFORE the diff, so an
      // archived project cannot be edited even by a payload that happens to change nothing.
      if (current.status === 'archived') {
        throw new AppError('GATE', 'This project is archived and cannot be edited', {
          reason: 'project_archived',
          projectId: current.id,
        });
      }

      const submitted: ProjectEdit = {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.clientId !== undefined && { clientId: parsed.clientId }),
        ...(parsed.startDate !== undefined && { startDate: parsed.startDate }),
        ...(parsed.deadline !== undefined && { deadline: parsed.deadline }),
      };

      const changes: ProjectEdit = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const [field, next] of Object.entries(submitted) as [EditableField, string | null][]) {
        const currentValue = current[field] ?? null;
        const nextValue = next ?? null;
        if (currentValue === nextValue) continue; // submitted, but unchanged
        before[field] = currentValue;
        after[field] = nextValue;
        Object.assign(changes, { [field]: nextValue });
      }

      // Nothing actually moved: no UPDATE, no audit row.
      if (Object.keys(changes).length === 0) {
        return current;
      }

      // Only when the client is genuinely changing — re-validating an unchanged one would
      // block edits to a project whose client was archived after the project started, which
      // is legitimate historical work.
      if (changes.clientId !== undefined) {
        await requireLiveClient(tx, changes.clientId);
      }

      const [row] = await tx
        .update(projects)
        .set({ ...changes, updatedAt: clock.now() })
        .where(eq(projects.id, parsed.projectId))
        .returning();

      // 4. AUDIT — same tx (§9.8). before/after carry only the changed fields.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project.updated',
        resourceType: 'project',
        resourceId: parsed.projectId,
        before,
        after,
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.3.3).
  });
}

/**
 * §13.3.4 `archiveProject` — MGR (`project.archive`).
 *
 * Archiving sets `status='archived'`; it is NOT a soft delete (`deleted_at` is §13.3.5's
 * `deleteProject`). The row stays fully readable: archived projects drop out of pickers and
 * default filters but remain in `projectsListQuery`, which is where a manager confirms the
 * archive took.
 *
 * Guard `GATE:pending_reviews` (§13.3.4): no task on the project may be `submitted`. Archiving
 * out from under a pending review would strand work that someone is waiting on a decision for —
 * the review queue would hold a task belonging to a project that is read-only everywhere else.
 * The error carries the blocking task's id AND title so the toast can name it rather than
 * saying "some task"; §14.15 requires gate errors to name the specific blocker.
 *
 * Archiving an already-archived project is a no-op with no audit row — the audit log records
 * things that happened, and a double-click must not manufacture a second "archived" event.
 * Same reasoning as `archiveClient`.
 *
 * Notify: none (§13.3.4).
 */
export async function archiveProject(input: ArchiveProjectInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ArchiveProjectInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project.archive');

    // 3. TRANSACT — the guard and the write share one snapshot, so a task submitted between
    // the check and the UPDATE cannot slip through.
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects)
        .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Project not found');
      }

      if (current.status === 'archived') {
        return current;
      }

      const blockers = await tx
        .select({ id: projectTasks.id, title: projectTasks.title })
        .from(projectTasks)
        .where(
          and(
            eq(projectTasks.projectId, parsed.projectId),
            eq(projectTasks.status, 'submitted'),
            isNull(projectTasks.deletedAt),
          ),
        );

      if (blockers.length > 0) {
        // Name the first blocker in the message — §14.15 r.3: a gate says which task, not
        // "some task". The full list rides in details for a UI that wants to render them all.
        const [first] = blockers;
        throw new AppError(
          'GATE',
          blockers.length === 1
            ? `"${first.title}" is awaiting review. Decide it before archiving.`
            : `"${first.title}" and ${blockers.length - 1} other task(s) are awaiting review. Decide them before archiving.`,
          {
            reason: 'pending_reviews',
            taskId: first.id,
            taskTitle: first.title,
            taskIds: blockers.map((b) => b.id),
            tasks: blockers,
          },
        );
      }

      const [row] = await tx
        .update(projects)
        .set({ status: 'archived', updatedAt: clock.now() })
        .where(eq(projects.id, parsed.projectId))
        .returning({ id: projects.id, name: projects.name, status: projects.status });

      // 4. AUDIT — same tx (§9.8 `project.archived`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project.archived',
        resourceType: 'project',
        resourceId: parsed.projectId,
        before: { status: 'active' },
        after: { status: 'archived' },
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.3.4).
  });
}

/**
 * §13.3.4's reverse — `unarchiveProject`, MGR (`project.unarchive`).
 *
 * §13.3.4 defines the action and its audience ("same actors") but §9.6 has no row for it, so
 * `project.unarchive` was added to `lib/authz.ts` encoded exactly like `project.archive` —
 * the same gap `employee.reactivate` already had, and §9.6 should gain both rows.
 *
 * No guard beyond existence. Archiving is what has a precondition; restoring a project to the
 * working set cannot strand anything, and the tasks that were there are still there — nothing
 * was deleted, only hidden from default filters.
 *
 * Un-archiving an already-active project is a no-op with no audit row, mirroring archive.
 *
 * Notify: none (§13.3.4 names none).
 */
export async function unarchiveProject(input: UnarchiveProjectInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UnarchiveProjectInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project.unarchive');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects)
        .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Project not found');
      }

      if (current.status === 'active') {
        return current;
      }

      const [row] = await tx
        .update(projects)
        .set({ status: 'active', updatedAt: clock.now() })
        .where(eq(projects.id, parsed.projectId))
        .returning({ id: projects.id, name: projects.name, status: projects.status });

      // 4. AUDIT — same tx (§9.8 covers "project create/archive/delete"; the reverse of an
      // audited act is itself accountability-bearing, so it is audited too).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project.unarchived',
        resourceType: 'project',
        resourceId: parsed.projectId,
        before: { status: 'archived' },
        after: { status: 'active' },
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.3.4).
  });
}

/**
 * §13.4.1 `createTask` — MGR (`project_task.create`, §9.6: SA / TL / PM allow, HR / EMP deny).
 *
 * The three §13.4.1 guards, in the order the transaction applies them:
 *
 *   1. **Project active.** Missing or soft-deleted → `NOT_FOUND`; `status='archived'` → `GATE`
 *      with `reason: 'project_archived'` — the SAME reason string `updateProject` already
 *      throws, not a second one, because it is the same rule: §13.3.4 makes archived projects
 *      read-only everywhere, and adding work to one is exactly what archiving prevents.
 *
 *   2. **Assignee active and not SA.** Amendment E / §9.7-4: the super_admin is the CEO and
 *      never executes delivery work. The `pt_no_sa_assignee` trigger (migration 0006) is the
 *      belt and this check is the braces — and the check has to come FIRST, because a trigger
 *      rejection surfaces as a raw Postgres error, which is not an `AppError` and so is
 *      re-thrown by `actionResult` and redacted in production. Without the app-layer check the
 *      manager would get an opaque digest instead of "pick someone else".
 *
 *   3. **`dependsOn` is a live task in the same project.** No cycle walk is needed here: the
 *      task being created does not exist yet, so nothing can depend on it, so no edge added
 *      now can close a loop — a cycle is structurally impossible at create time, and the
 *      `no_self_dependency` CHECK backs the one-hop case. **The full chain walk belongs to
 *      §13.4.2 `updateTaskFields`** (a later ticket), where an existing task with existing
 *      dependents CAN acquire an edge that closes a cycle.
 *
 * Timestamps come from the clock port rather than the column defaults, so `created_at` and
 * `updated_at` sit on one timeline under a frozen test clock — the same reason `createProject`
 * and `createClient` do it.
 *
 * Notify: `N:task_assigned` → the assignee if one was named (§13.4.1), enqueued AFTER the
 * transaction commits (§12.4 step 5) — a rolled-back task must not announce itself. The type
 * is already in the `NotificationType` union (§13.9); nothing was added there.
 */
export async function createTask(input: CreateTaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateTaskInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project_task.create');

    // 3. TRANSACT — every guard reads on `tx`, so the checks and the insert share one snapshot
    // and a project archived (or an assignee deactivated) mid-flight cannot slip through.
    const row = await withTx(async (tx) => {
      // The same read `updateProject` uses: soft-deleted rows are invisible, then archived is
      // a separate, more specific refusal.
      const [project] = await tx
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!project) {
        throw new AppError('NOT_FOUND', 'Project not found');
      }

      if (project.status === 'archived') {
        throw new AppError('GATE', 'This project is archived and cannot take new tasks', {
          reason: 'project_archived',
          projectId: project.id,
        });
      }

      if (parsed.assigneeId !== undefined) {
        const [assignee] = await tx
          .select({ id: userTable.id, name: userTable.name, role: userTable.role, active: userTable.active })
          .from(userTable)
          .where(eq(userTable.id, parsed.assigneeId))
          .limit(1);

        if (!assignee) {
          throw new AppError('NOT_FOUND', 'Assignee not found');
        }

        // `active` is checked before `role`: an offboarded teammate is the likelier mistake and
        // "they are deactivated" is the more actionable sentence. Both are hard refusals, and
        // a deactivated SA is refused either way.
        if (!assignee.active) {
          throw new AppError('GATE', `${assignee.name} is deactivated and cannot hold tasks`, {
            reason: 'inactive_assignee',
            assigneeId: assignee.id,
          });
        }

        if (assignee.role === 'super_admin') {
          throw new AppError('GATE', 'A super admin can never be assigned delivery work', {
            reason: 'sa_assignee',
            assigneeId: assignee.id,
          });
        }
      }

      if (parsed.dependsOn !== undefined) {
        const [target] = await tx
          .select({ id: projectTasks.id, projectId: projectTasks.projectId })
          .from(projectTasks)
          .where(and(eq(projectTasks.id, parsed.dependsOn), isNull(projectTasks.deletedAt)))
          .limit(1);

        // One refusal for "no such live task" and "lives in another project" alike: from the
        // caller's side both mean the same thing — that id is not something this task may
        // depend on. §13.4.1 names the rule as "same project", so the reason says that.
        if (!target || target.projectId !== parsed.projectId) {
          throw new AppError(
            'GATE',
            'A task can only depend on another task in the same project',
            { reason: 'bad_dependency', dependsOn: parsed.dependsOn },
          );
        }
      }

      const id = `pt_${crypto.randomUUID()}`;
      const now = clock.now();

      const [created] = await tx
        .insert(projectTasks)
        .values({
          id,
          projectId: parsed.projectId,
          title: parsed.title,
          category: parsed.category,
          month: parsed.month ?? null,
          description: parsed.description ?? null,
          assigneeId: parsed.assigneeId ?? null,
          dueDate: parsed.dueDate ?? null,
          // `numeric(6, 2)` is a STRING on the way in and out of drizzle, not a number — the
          // column keeps more precision than an IEEE double does, so drizzle refuses to lose
          // it silently. `.toFixed(2)` is the explicit conversion at the one place that has a
          // number in hand.
          estimatedHours:
            parsed.estimatedHours !== undefined ? parsed.estimatedHours.toFixed(2) : null,
          expectedOutput: parsed.expectedOutput ?? null,
          sopUrl: parsed.sopUrl ?? null,
          // Spread, not `?? 'medium'` / `?? true`: an absent key must leave the column DEFAULT
          // to apply (§11.3), because restating those values here would make this a second
          // place they are written down. `status` and `version` are never sent at all.
          ...(parsed.priority !== undefined && { priority: parsed.priority }),
          ...(parsed.qcRequired !== undefined && { qcRequired: parsed.qcRequired }),
          ...(parsed.proofRequired !== undefined && { proofRequired: parsed.proofRequired }),
          ...(parsed.clientVisible !== undefined && { clientVisible: parsed.clientVisible }),
          dependsOn: parsed.dependsOn ?? null,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Seeds the INITIAL checklist only — `position` is the input's own order, which is the
      // order the manager typed. Add / toggle / remove are §13.4.10 (PUL-405), and the
      // post-submission lock that governs them is not this action's business.
      if (parsed.checklist !== undefined && parsed.checklist.length > 0) {
        await tx.insert(taskChecklistItems).values(
          parsed.checklist.map((text, index) => ({
            id: `tci_${crypto.randomUUID()}`,
            taskId: id,
            text,
            done: false,
            position: index,
            createdAt: now,
          })),
        );
      }

      // 4. AUDIT — same tx (§9.8 `project_task.created`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.created',
        resourceType: 'project_task',
        resourceId: id,
        before: null,
        after: created,
      });

      return created;
    });

    // 5. NOTIFY — after commit, never inside the tx (§13.4.1 `N:task_assigned` → assignee if
    // set). An unassigned task notifies nobody: there is nobody to tell yet, and the managers
    // who would care are the ones who just created it.
    if (row.assigneeId !== null) {
      await notify({
        to: row.assigneeId,
        type: 'task_assigned',
        data: { taskId: row.id, taskTitle: row.title, projectId: row.projectId, assignedBy: actor.id },
      });
    }

    return row;
  });
}
