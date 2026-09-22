// features/projects/actions.ts
//
// Project actions (§13.3). Built to the 5-step shape from features/_example/actions.ts:
// validate → authorize → withTx → writeAudit → notify, inside the PUL-111 `actionResult`
// boundary.
//
// §13.3.1 createProject · §13.3.3 updateProject · §13.3.4 archiveProject / unarchiveProject.
// §13.4.1 createTask · §13.4.3 assignTask (PUL-403) — the slice owns project-task actions too.
// §13.4.4 changeTaskStatusOpen · §13.4.5 setTaskStatusProtected (PUL-404).
// §13.4.9 addSubtask / toggleSubtask / deleteSubtask (PUL-405).
// Still to come: §13.3.5 `deleteProject` (SA only) and §13.3.2 `createProjectFromTemplate`
// (PUL-506, the Start Project wizard).

'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  clients,
  projectTasks,
  projects,
  taskChecklistItems,
  taskSubtasks,
  user as userTable,
} from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize, type User } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { withTx, type Executor } from '../../lib/mutation';
import { notify } from '../../lib/notifications';
import { writeAudit } from '../audit/write-audit';
import { MANAGER_ROLES } from '../employees/queries';
import {
  AddSubtaskInput,
  ArchiveProjectInput,
  AssignTaskInput,
  ChangeTaskStatusOpenInput,
  CreateProjectInput,
  CreateTaskInput,
  DeleteSubtaskInput,
  SetTaskStatusProtectedInput,
  ToggleSubtaskInput,
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
 * Resolve a user who may legally hold a task: they must exist, be active, and not be the
 * super_admin (Amendment E / §9.7-4 — the CEO assigns and approves, never executes).
 *
 * Shared by §13.4.1 `createTask` and §13.4.3 `assignTask`, which state the identical rule
 * ("assignee active, not SA"). One implementation rather than two, because §9.6's note is that
 * this invariant is **absolute — there is no exception path**, and two copies is how a future
 * edit gives one of them an exception nobody notices.
 *
 * Takes the executor FIRST so callers pass their `tx`, the same convention as
 * `requireLiveClient` and `getClientProjectUsage`: the check and the write then share one
 * snapshot, so a user deactivated between the guard and the UPDATE cannot slip through.
 *
 * **The app-layer check exists even though `pt_no_sa_assignee` (migration 0006) enforces the
 * SA half at the database.** The trigger is the belt and this is the braces, and the braces
 * have to come first: a trigger rejection is a raw Postgres error, not an `AppError`, so
 * `actionResult` re-throws it and production redacts it into an opaque digest. Without this,
 * the manager would see "Something went wrong" instead of "pick someone else".
 */
async function requireAssignableUser(executor: Executor, assigneeId: string): Promise<void> {
  const [assignee] = await executor
    .select({
      id: userTable.id,
      name: userTable.name,
      role: userTable.role,
      active: userTable.active,
    })
    .from(userTable)
    .where(eq(userTable.id, assigneeId))
    .limit(1);

  if (!assignee) {
    throw new AppError('NOT_FOUND', 'Assignee not found');
  }

  // `active` is checked before `role`: an offboarded teammate is the likelier mistake and
  // "they are deactivated" is the more actionable sentence. Both are hard refusals, and a
  // deactivated super_admin is refused either way.
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
 *   2. **Assignee active and not SA** — `requireAssignableUser`, shared with §13.4.3
 *      `assignTask`, which states the identical rule. See that helper for why the app-layer
 *      check exists on top of the `pt_no_sa_assignee` trigger.
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
        await requireAssignableUser(tx, parsed.assigneeId);
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

/**
 * §13.4.3 `assignTask` — MGR (`project_task.assign`, §9.6: SA / TL / PM allow, HR / EMP deny).
 *
 * `{ taskId, assigneeId | null }`, where null unassigns and returns the task to the Board's
 * "Unassigned" group.
 *
 * **403.3 — verified, no self-claim path exists anywhere.** §13.4.3 records the decision
 * explicitly: "there is **no employee self-claim flow** — unassigned tasks are assigned by
 * managers... If self-claim is ever wanted, it's a new contract entry, not a widening of this
 * one." This action is the only writer of `assignee_id` outside `createTask` (also MGR-only),
 * both are gated on MGR permissions, and no action anywhere lets a caller set their own
 * `assignee_id`. Nothing was built for 403.3; the check is that nothing needed to be.
 *
 * Guards, in order:
 *   1. **Task exists and is not soft-deleted** → `NOT_FOUND`.
 *   2. **The task's project is not archived** → `GATE:project_archived`, the same shared reason
 *      `updateProject` and `createTask` throw. Re-assigning work on an archived project is a
 *      content edit, and §13.3.4 makes archived projects read-only everywhere — the rule does
 *      not weaken just because the column being written is `assignee_id`.
 *   3. **The new assignee is active and not SA** — `requireAssignableUser`, skipped entirely
 *      when `assigneeId` is null. Unassigning has no assignee to validate, and it must stay
 *      possible precisely when the current assignee has gone inactive: offboarding
 *      (§13.1.4) reassigns a leaver's tasks, and a guard that ran on unassign would deadlock
 *      the one operation that resolves a deactivated user's workload.
 *
 * **No `version` bump and no optimistic lock** (§13.4.3 defines neither). `updated_at` still
 * moves, from the clock port.
 *
 * **Idempotent on an unchanged assignee**, the same rule as `updateProject`, `archiveProject`
 * and `reactivateEmployee`: assigning a task to the person who already holds it — or
 * unassigning one that is already unassigned — writes nothing at all. No UPDATE, no
 * `updated_at` bump, no audit row, no notification; the current row comes back unchanged. The
 * audit log records things that happened, and a double-clicked dropdown must not manufacture a
 * second "assigned" event or re-ping someone who was told days ago.
 *
 * Notify: `N:task_assigned` → the new assignee (§13.4.3), after commit, **only when the
 * assignee actually changed**. An unassign notifies nobody — there is no one to tell, and the
 * previous holder learns it from the board.
 */
export async function assignTask(input: AssignTaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = AssignTaskInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('project_task.assign');

    // 3. TRANSACT — guards and the UPDATE share one snapshot.
    const result = await withTx(async (tx) => {
      const [task] = await tx
        .select({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
        })
        .from(projectTasks)
        .where(and(eq(projectTasks.id, parsed.taskId), isNull(projectTasks.deletedAt)))
        .limit(1);

      if (!task) {
        throw new AppError('NOT_FOUND', 'Task not found');
      }

      const [project] = await tx
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(and(eq(projects.id, task.projectId), isNull(projects.deletedAt)))
        .limit(1);

      if (!project) {
        throw new AppError('NOT_FOUND', 'Project not found');
      }

      if (project.status === 'archived') {
        throw new AppError('GATE', 'This project is archived and its tasks cannot be reassigned', {
          reason: 'project_archived',
          projectId: project.id,
        });
      }

      // Nothing actually moved: no UPDATE, no `updated_at` bump, no audit row — and the caller
      // gets the current row back, exactly as `updateProject` / `archiveProject` /
      // `reactivateEmployee` do. The audit log records things that HAPPENED, and re-assigning a
      // task to the person who already holds it (or re-unassigning an unassigned one) is not an
      // event. `null === null` counts as unchanged, which is why this compares the values rather
      // than testing for null.
      //
      // Placed AFTER the archived-project gate deliberately: §13.3.4 makes an archived project
      // refuse edits even when the payload happens to change nothing, which is the same ordering
      // `updateProject` documents. It runs BEFORE the assignee guard, so a no-change request
      // naming a since-deactivated current holder stays a no-op instead of failing a guard on
      // state it is not trying to alter.
      if (parsed.assigneeId === task.assigneeId) {
        return { row: task, changed: false };
      }

      if (parsed.assigneeId !== null) {
        await requireAssignableUser(tx, parsed.assigneeId);
      }

      const [row] = await tx
        .update(projectTasks)
        // `version` is deliberately untouched — §13.4.3 has no optimistic lock.
        .set({ assigneeId: parsed.assigneeId, updatedAt: clock.now() })
        .where(eq(projectTasks.id, parsed.taskId))
        .returning({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
        });

      // 4. AUDIT — same tx (§9.8 `project_task.assigned`). before/after carry the one column
      // that moved, so the log answers "who did this belong to before?" directly.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.assigned',
        resourceType: 'project_task',
        resourceId: parsed.taskId,
        before: { assigneeId: task.assigneeId },
        after: { assigneeId: parsed.assigneeId },
      });

      return { row, changed: true };
    });

    // 5. NOTIFY — after commit, never inside the tx (§13.4.3 `N:task_assigned` → new assignee).
    //
    // `changed` rides out of the transaction rather than being re-derived here, because the two
    // silent cases are indistinguishable from the returned row alone: a no-op on an already-held
    // task returns a row with a non-null `assigneeId`, exactly like a real assignment does. The
    // flag is what keeps a no-op from re-pinging someone who was told days ago.
    if (result.changed && result.row.assigneeId !== null) {
      await notify({
        to: result.row.assigneeId,
        type: 'task_assigned',
        data: {
          taskId: result.row.id,
          taskTitle: result.row.title,
          projectId: result.row.projectId,
          assignedBy: actor.id,
        },
      });
    }

    return result.row;
  });
}

/**
 * The §13.4.4 open statuses — the ones a task may move OUT of through the pill.
 *
 * Note `revision_required` is exitable but not settable (see `ChangeTaskStatusOpenInput`): a
 * task in revision gets back to work through this action, but only §13.4.7 / §13.4.5 put it
 * there. Everything absent from this list — `submitted`, `approved`, `completed`, `cancelled` —
 * is a locked state that §13.4.4 refuses to move at all.
 *
 * **`blocked` here is the REAL, STORED status** — the pill an employee sets when they are stuck
 * on something external. It is NOT the §3.2.5 dependency lock, which is **display-only and
 * never stored**: a task whose `depends_on` is unresolved RENDERS as blocked in the UI while
 * its stored `status` stays whatever it actually is. Conflating the two would make the
 * dependency lock a mutation, and re-resolving a dependency would then have to guess which
 * status to restore.
 */
const OPEN_STATUSES = ['planned', 'in_progress', 'blocked', 'revision_required'] as const;

/**
 * §13.4.4 `changeTaskStatusOpen` — MGR anywhere; EMP only if assignee
 * (`project_task.set_status_open`, §9.6: SA / TL / PM allow, HR deny, EMP conditional
 * `assignee`).
 *
 * ── THE OPTIMISTIC-LOCK REFERENCE IMPLEMENTATION ─────────────────────────────────────────
 * This is the first action to take a `version`, and later task mutations (§13.4.2
 * `updateTaskFields`, §13.4.5 `setTaskStatusProtected`, §13.4.7 `reviewTask`) should copy the
 * shape below rather than reinvent it. The three rules that make it correct:
 *
 *   1. **The version test lives in the UPDATE's WHERE clause, not in an `if`.** Reading the
 *      row, comparing versions in JS, then updating is not a lock at all — two requests can
 *      both read version 3 and both pass the comparison. Postgres evaluates the WHERE while
 *      holding the row lock, so exactly one of two concurrent writers matches.
 *   2. **Zero rows affected IS the conflict signal.** The row was read moments earlier inside
 *      this same transaction, so it exists; if the UPDATE matches nothing, the only thing that
 *      can have changed is `version`. That is a lost race, and it is a `CONFLICT`.
 *   3. **Never re-read to "fix" a conflict.** Re-reading and retrying with the fresh version
 *      would apply the caller's intent on top of a row they never saw — which is precisely the
 *      lost update the lock exists to prevent. `CONFLICT` goes back to the client, whose toast
 *      offers Refresh (§14.15 r.3); refetch-and-retry is the user's decision, not ours.
 *
 * ── Authorization ────────────────────────────────────────────────────────────────────────
 * The EMP cell is the conditional `'assignee'` marker, so `can()` needs the subject to decide
 * — and `authorize()` without a resource would deny every employee, including the rightful
 * assignee. The task is therefore read BEFORE `authorize`, which `features/_example/actions.ts`
 * and §9.8's own example both sanction: a read decides nothing, and the ESLint rule's contract
 * is "authorize before `withTx`", not "authorize before any await".
 *
 * That pre-read is outside the transaction, so the ownership check is made again INSIDE it,
 * against the transaction's snapshot — see the note at that check. Managers skip both: §9.6
 * grants SA/TL/PM the unconditional cell, and §4.3 is explicit that managers can move anything.
 *
 * Notify: none — §13.4.4 lists no notification. (§13.4.5's manager override does notify the
 * assignee; a self-driven pill change has nobody to tell.)
 */
export async function changeTaskStatusOpen(input: ChangeTaskStatusOpenInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ChangeTaskStatusOpenInput.parse(input);

    // 1b. SUBJECT READ — permitted before `authorize` because a read decides nothing, and
    // required because the EMP cell is conditional on this row's assignee (see the docblock).
    const [subject] = await db
      .select({ id: projectTasks.id, assigneeId: projectTasks.assigneeId })
      .from(projectTasks)
      .where(and(eq(projectTasks.id, parsed.taskId), isNull(projectTasks.deletedAt)))
      .limit(1);

    if (!subject) {
      throw new AppError('NOT_FOUND', 'Task not found');
    }

    // 2. AUTHORIZE — the security boundary, before any write (§9.5 rule 1).
    const actor = await authorize('project_task.set_status_open', {
      assigneeId: subject.assigneeId ?? undefined,
    });

    // 3. TRANSACT
    const result = await withTx(async (tx) => {
      const [task] = await tx
        .select({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
          status: projectTasks.status,
          version: projectTasks.version,
          updatedAt: projectTasks.updatedAt,
        })
        .from(projectTasks)
        .where(and(eq(projectTasks.id, parsed.taskId), isNull(projectTasks.deletedAt)))
        .limit(1);

      // Soft-deleted between the subject read and the transaction — rare, but the pre-read
      // snapshot is not authoritative for anything.
      if (!task) {
        throw new AppError('NOT_FOUND', 'Task not found');
      }

      // ROW-LEVEL OWNERSHIP, re-checked on the transaction's snapshot. `authorize` already
      // decided this from the pre-read, so in the ordinary case this is belt-and-braces; it
      // earns its place in the race where the task is REASSIGNED between the two reads, which
      // would otherwise let the old assignee move a task that is no longer theirs.
      //
      // Managers are exempt by §9.6 — the unconditional cell means "any task".
      if (actor.role === 'employee' && task.assigneeId !== actor.id) {
        throw new AppError('FORBIDDEN', 'This task is not assigned to you', {
          reason: 'not_assignee',
        });
      }

      // §13.4.4: the locked states are not exitable here. `submitted` waits on a review
      // decision, and `approved` / `completed` / `cancelled` are terminal — moving out of any
      // of them is a manager override (§13.4.5) or a review (§13.4.7), never a pill change.
      if (!(OPEN_STATUSES as readonly string[]).includes(task.status)) {
        throw new AppError('GATE', `"${task.title}" is ${task.status} and cannot be moved here`, {
          reason: 'locked',
          status: task.status,
        });
      }

      // Idempotent no-op, matching the slice convention (`assignTask`, `updateProject`,
      // `archiveProject`). Note this deliberately sits BEFORE the version check: a request that
      // changes nothing has nothing to lose a race over, so a stale version on a no-op is not a
      // conflict worth surfacing — there is no lost update when there is no update.
      if (task.status === parsed.status) {
        return { row: task, changed: false };
      }

      // ── The optimistic-locked UPDATE (the pattern described above) ───────────────────────
      const updated = await tx
        .update(projectTasks)
        .set({
          status: parsed.status,
          version: sql`${projectTasks.version} + 1`,
          updatedAt: clock.now(),
        })
        .where(
          and(
            eq(projectTasks.id, parsed.taskId),
            eq(projectTasks.version, parsed.version),
            isNull(projectTasks.deletedAt),
          ),
        )
        .returning({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
          status: projectTasks.status,
          version: projectTasks.version,
        });

      // Zero rows: the row exists (we just read it in this transaction), so `version` is the
      // only predicate that can have failed. Someone else wrote first.
      if (updated.length === 0) {
        throw new AppError('CONFLICT', 'This task changed while you were looking at it', {
          reason: 'stale_version',
          expectedVersion: parsed.version,
          actualVersion: task.version,
        });
      }

      const [row] = updated;

      // 4. AUDIT — same tx (§9.8 `project_task.status_changed`). The version pair is recorded
      // alongside the status so the log shows which revision of the row moved.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.status_changed',
        resourceType: 'project_task',
        resourceId: parsed.taskId,
        before: { status: task.status, version: task.version },
        after: { status: row.status, version: row.version },
      });

      return { row, changed: true };
    });

    // 5. NOTIFY — none (§13.4.4).

    return result.row;
  });
}

/**
 * §13.4.5 `setTaskStatusProtected` — MGR only (`project_task.set_status_protected`, §9.6:
 * SA / TL / PM allow, HR and EMP deny).
 *
 * The manager override: the statuses an employee can never reach from the pill. **No row-level
 * ownership check** — unlike §13.4.4, the §9.6 cell is unconditional for all three manager
 * roles, and §4.3 is explicit that a manager may override any task, assigned to them or not.
 *
 * The optimistic lock is character-for-character the shape `changeTaskStatusOpen` establishes;
 * read that action's docblock for why the version test lives in the WHERE clause and why a
 * `CONFLICT` is never "fixed" by re-reading.
 *
 * Guards, in the order they run:
 *
 *   1. **`approved` is refused outright — `GATE:use_review`.** Approving a submitted task has
 *      to go through §13.4.7 `reviewTask` (Phase 6) so that a `task_reviews` row exists. An
 *      approval with no review row is an approval nobody signed, and the QC trail is the whole
 *      point of the status. This is checked FIRST so the answer does not depend on the origin
 *      status: direct-approve is wrong from everywhere.
 *   2. **`revision_required` requires a `note` — `GATE:note_required`.** Sending work back
 *      without saying why is the failure mode the note exists to prevent (§14.3.2's modal).
 *   3. **Same status is a no-op**, matching the slice convention (`assignTask`,
 *      `changeTaskStatusOpen`, `updateProject`). Note `approved → approved` never reaches this
 *      branch — guard 1 already refused it — so the no-op covers the three reachable targets.
 *
 * **`cancelled` from `submitted` is allowed, and resolves the open submission implicitly.**
 * There is no orphan to clean up: the submission row simply never receives a review, and the
 * review queue reads only `status = 'submitted'` (the `pt_review_q_idx` predicate, §11.3), so
 * a cancelled task drops out of it cleanly. Deleting or back-filling the submission would
 * destroy the record that the work WAS submitted, which is exactly what the QC trail is for.
 *
 * **`completed` from a non-terminal state is the QC bypass, and it is allowed on purpose**
 * (§4.2) — that is what the status is for. What makes it safe is that it is loud: the audit row
 * is written with the DISTINCT action `project_task.status_overridden`, never
 * `status_changed`, so "how often did we bypass QC?" is one grep rather than a judgement call.
 *
 * Notify: `N:task_status_changed` → the assignee (§13.4.5), after commit, only when the status
 * actually moved. An unassigned task notifies nobody.
 */
export async function setTaskStatusProtected(input: SetTaskStatusProtectedInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = SetTaskStatusProtectedInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1). No resource: the §9.6 cell is
    // unconditional for every role that holds this permission, so there is nothing to scope.
    const actor = await authorize('project_task.set_status_protected');

    // 3. TRANSACT
    const result = await withTx(async (tx) => {
      const [task] = await tx
        .select({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
          status: projectTasks.status,
          version: projectTasks.version,
        })
        .from(projectTasks)
        .where(and(eq(projectTasks.id, parsed.taskId), isNull(projectTasks.deletedAt)))
        .limit(1);

      if (!task) {
        throw new AppError('NOT_FOUND', 'Task not found');
      }

      // Guard 1 — direct approve is never allowed here (§13.4.5).
      if (parsed.status === 'approved') {
        throw new AppError('GATE', 'Approve this task from the review screen, not the status menu', {
          reason: 'use_review',
          taskId: task.id,
        });
      }

      // Guard 2 — a revision has to say why (§13.4.5).
      if (parsed.status === 'revision_required' && parsed.note === undefined) {
        throw new AppError('GATE', 'Say what needs changing before sending this back', {
          reason: 'note_required',
          taskId: task.id,
        });
      }

      // Guard 3 — idempotent no-op, the slice convention. Deliberately after the two gates: a
      // malformed override is refused on its own terms even when it would change nothing.
      if (task.status === parsed.status) {
        return { row: task, changed: false };
      }

      // ── The optimistic-locked UPDATE — the pattern from `changeTaskStatusOpen` ───────────
      const updated = await tx
        .update(projectTasks)
        .set({
          status: parsed.status,
          // §13.4.5 carries a note for the revision case; §11.3 keeps the latest one on the row
          // as a denormalized convenience, with the full trail living in `task_reviews`.
          ...(parsed.note !== undefined && { revisionNote: parsed.note }),
          version: sql`${projectTasks.version} + 1`,
          updatedAt: clock.now(),
        })
        .where(
          and(
            eq(projectTasks.id, parsed.taskId),
            eq(projectTasks.version, parsed.version),
            isNull(projectTasks.deletedAt),
          ),
        )
        .returning({
          id: projectTasks.id,
          title: projectTasks.title,
          projectId: projectTasks.projectId,
          assigneeId: projectTasks.assigneeId,
          status: projectTasks.status,
          version: projectTasks.version,
        });

      if (updated.length === 0) {
        throw new AppError('CONFLICT', 'This task changed while you were looking at it', {
          reason: 'stale_version',
          expectedVersion: parsed.version,
          actualVersion: task.version,
        });
      }

      const [row] = updated;

      // 4. AUDIT — same tx, and under its OWN action name (§13.4.5). `status_overridden` rather
      // than `status_changed` is what makes the QC bypass greppable: the two paths must never
      // share an action string, or "was this approved or waved through?" stops being answerable.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.status_overridden',
        resourceType: 'project_task',
        resourceId: parsed.taskId,
        before: { status: task.status, version: task.version },
        after: {
          status: row.status,
          version: row.version,
          ...(parsed.note !== undefined && { note: parsed.note }),
        },
      });

      return { row, changed: true };
    });

    // 5. NOTIFY — after commit (§13.4.5 `N:task_status_changed` → assignee). Skipped on a no-op
    // for the same reason as `assignTask`: nothing happened, so there is nothing to announce.
    if (result.changed && result.row.assigneeId !== null) {
      await notify({
        to: result.row.assigneeId,
        type: 'task_status_changed',
        data: {
          taskId: result.row.id,
          taskTitle: result.row.title,
          status: result.row.status,
          changedBy: actor.id,
        },
      });
    }

    return result.row;
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §13.4.9 subtasks (PUL-405).
//
// **Subtasks are informational only — they NEVER gate submission** (§13.4.9, §9.6 ⁷, §16.8).
// Nothing in this block reads, writes or participates in a submission gate, and nothing should:
// the checklist (§13.4.10, `task_checklist_items`) is the definition-of-done that `submitTask`
// checks; subtasks exist only to help the assignee break the work down.
//
// No `version` / optimistic lock here. These actions write `task_subtasks` child rows, never
// the `project_tasks` row, so there is no task version to race over — and §13.4.9 specifies
// none.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** The task fields the subtask (and, in PUL-405 Stage 2, checklist) guards decide on. */
type ChildEditTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  status: (typeof projectTasks.$inferSelect)['status'];
};

/**
 * Resolve a live task by id: NOT_FOUND when missing or soft-deleted.
 *
 * Takes the executor FIRST, the slice convention: called once on the global `db` for the
 * pre-`authorize` subject read, and again on `tx` so the guards see the transaction's snapshot.
 */
async function requireLiveTask(executor: Executor, taskId: string): Promise<ChildEditTask> {
  const [task] = await executor
    .select({
      id: projectTasks.id,
      title: projectTasks.title,
      assigneeId: projectTasks.assigneeId,
      status: projectTasks.status,
    })
    .from(projectTasks)
    .where(and(eq(projectTasks.id, taskId), isNull(projectTasks.deletedAt)))
    .limit(1);

  if (!task) {
    throw new AppError('NOT_FOUND', 'Task not found');
  }

  return task;
}

/**
 * Resolve a subtask AND its live task. NOT_FOUND if the subtask is missing, or if its task is
 * soft-deleted — a subtask of a deleted task is not something anyone can act on.
 * (`task_subtasks` has no `deleted_at` of its own; removal is a hard delete.)
 */
async function requireSubtask(executor: Executor, subtaskId: string) {
  const [subtask] = await executor
    .select()
    .from(taskSubtasks)
    .where(eq(taskSubtasks.id, subtaskId))
    .limit(1);

  if (!subtask) {
    throw new AppError('NOT_FOUND', 'Subtask not found');
  }

  const task = await requireLiveTask(executor, subtask.taskId);
  return { subtask, task };
}

/**
 * The row-level guard for editing a task's child rows — subtasks now, the checklist in PUL-405
 * Stage 2. Call it INSIDE the transaction, on the tx-read task.
 *
 *   1. **Ownership.** A non-manager must be the task's assignee → `FORBIDDEN` `not_assignee`
 *      (PUL-404's reason). `authorize()` already decided this from the pre-read; this re-check
 *      on the transaction's snapshot closes the reassigned-mid-flight race, exactly as in
 *      `changeTaskStatusOpen`.
 *   2. **The post-submission lock.** A non-manager cannot edit while the task is `submitted`
 *      → `GATE:locked` (§14.3.3 lock). Managers bypass BOTH: §13.4.9 "MGR edits remain
 *      possible via the manager-override path and never retro-gate", and §4.3 lets a manager
 *      override anything.
 *
 * "Manager" is `MANAGER_ROLES`, and the test is "not a manager" rather than "is an employee"
 * so the guard fails closed: any role that is not manager-level gets both checks. (HR never
 * reaches here — §9.6 denies it at `authorize`.)
 *
 * Subtasks are informational: this guard protects the ROWS from being edited, it does not
 * gate submission — see the block comment above.
 */
function guardTaskChildEdit(actor: User, task: ChildEditTask): void {
  if ((MANAGER_ROLES as readonly string[]).includes(actor.role)) return;

  if (task.assigneeId !== actor.id) {
    throw new AppError('FORBIDDEN', 'This task is not assigned to you', {
      reason: 'not_assignee',
    });
  }

  if (task.status === 'submitted') {
    throw new AppError('GATE', `"${task.title}" is awaiting review and is locked`, {
      reason: 'locked',
      status: task.status,
      taskId: task.id,
    });
  }
}

/**
 * §13.4.9 `addSubtask` — assignee or MGR (`project_task.subtask_manage`, §9.6 ⁷: SA / TL / PM
 * allow, HR deny, EMP conditional `assignee`).
 *
 * The task is read before `authorize` because the EMP cell is conditional on its assignee —
 * the same sanctioned pre-read as `changeTaskStatusOpen`. `position` is max + 1 for the task
 * (0 for the first), so new subtasks land at the end of the list.
 *
 * Notify: none — §13.4.9 lists no notification.
 */
export async function addSubtask(input: AddSubtaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = AddSubtaskInput.parse(input);

    // 1b. SUBJECT READ — decides nothing; the EMP cell needs the assignee.
    const subject = await requireLiveTask(db, parsed.taskId);

    // 2. AUTHORIZE
    const actor = await authorize('project_task.subtask_manage', {
      assigneeId: subject.assigneeId ?? undefined,
    });

    // 3. TRANSACT
    const row = await withTx(async (tx) => {
      const task = await requireLiveTask(tx, parsed.taskId);
      guardTaskChildEdit(actor, task);

      // `max()` comes back from the driver as a string or null; the coalesce makes the first
      // subtask position 0, and Number() normalises the type.
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${taskSubtasks.position}), -1) + 1` })
        .from(taskSubtasks)
        .where(eq(taskSubtasks.taskId, task.id));

      const [created] = await tx
        .insert(taskSubtasks)
        .values({
          id: `ts_${crypto.randomUUID()}`,
          taskId: task.id,
          text: parsed.text,
          done: false,
          position: Number(next),
          createdBy: actor.id,
          createdAt: clock.now(),
        })
        .returning();

      // 4. AUDIT — same tx. Keyed on the TASK, so the task's history shows its subtask edits.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.subtask_added',
        resourceType: 'project_task',
        resourceId: task.id,
        before: null,
        after: created,
      });

      return created;
    });

    // 5. NOTIFY — none (§13.4.9).

    return row;
  });
}

/**
 * §13.4.9 `toggleSubtask` — same permission and guards as `addSubtask`.
 *
 * `done` is the desired value (see `ToggleSubtaskInput`). When the row already holds it, the
 * call is an idempotent no-op — no UPDATE, no audit row — the slice convention for no-ops.
 * The no-op sits AFTER the guards, so a locked or foreign task is refused rather than
 * silently "succeeding".
 *
 * Notify: none.
 */
export async function toggleSubtask(input: ToggleSubtaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ToggleSubtaskInput.parse(input);

    // 1b. SUBJECT READ
    const { task: subject } = await requireSubtask(db, parsed.subtaskId);

    // 2. AUTHORIZE
    const actor = await authorize('project_task.subtask_manage', {
      assigneeId: subject.assigneeId ?? undefined,
    });

    // 3. TRANSACT
    const row = await withTx(async (tx) => {
      const { subtask, task } = await requireSubtask(tx, parsed.subtaskId);
      guardTaskChildEdit(actor, task);

      if (subtask.done === parsed.done) {
        return subtask;
      }

      const [updated] = await tx
        .update(taskSubtasks)
        .set({ done: parsed.done })
        .where(eq(taskSubtasks.id, subtask.id))
        .returning();

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.subtask_toggled',
        resourceType: 'project_task',
        resourceId: task.id,
        before: { subtaskId: subtask.id, done: subtask.done },
        after: { subtaskId: updated.id, done: updated.done },
      });

      return updated;
    });

    // 5. NOTIFY — none (§13.4.9).

    return row;
  });
}

/**
 * §13.4.9 `deleteSubtask` — same permission and guards as `addSubtask`.
 *
 * A hard DELETE: `task_subtasks` has no `deleted_at` (§11.3.1). The removed row survives in
 * the audit row's `before`, which is the record of what was there.
 *
 * Notify: none.
 */
export async function deleteSubtask(input: DeleteSubtaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeleteSubtaskInput.parse(input);

    // 1b. SUBJECT READ
    const { task: subject } = await requireSubtask(db, parsed.subtaskId);

    // 2. AUTHORIZE
    const actor = await authorize('project_task.subtask_manage', {
      assigneeId: subject.assigneeId ?? undefined,
    });

    // 3. TRANSACT
    const removed = await withTx(async (tx) => {
      const { subtask, task } = await requireSubtask(tx, parsed.subtaskId);
      guardTaskChildEdit(actor, task);

      await tx.delete(taskSubtasks).where(eq(taskSubtasks.id, subtask.id));

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project_task.subtask_removed',
        resourceType: 'project_task',
        resourceId: task.id,
        before: subtask,
        after: null,
      });

      return subtask;
    });

    // 5. NOTIFY — none (§13.4.9).

    return removed;
  });
}
