// features/projects/schema.ts
//
// Input schemas for the projects slice, kept OUT of actions.ts for the same reason as
// features/employees/schema.ts and features/clients/schema.ts: actions.ts carries 'use server',
// and such a file may only export async functions — so a form that wants to reuse the schema
// for inline validation cannot import it from there. The action still re-parses as the real
// gate (§9.5 rule 2: the UI hides, the API refuses).

import { z } from 'zod';
import { taskPriority } from '../../db/schema/enums';

/**
 * §13.3.1 input — the manual create path. The template path is §13.3.2
 * (`createProjectFromTemplate`, PUL-506) and takes a different shape entirely.
 *
 * `type` is free text, not an enum: §11.2 documents it as `'Retainer' | 'One-off' | template
 * category`, and the third arm makes the set open — a template category is whatever a manager
 * named it. `.min(1)` is the whole constraint.
 *
 * Both dates stay `YYYY-MM-DD` strings end to end and never become a `Date`. The columns are
 * bare `date` (§11.0), read as Asia/Dhaka calendar days; constructing a `Date` anywhere on this
 * path is how a start date silently shifts a day for a UTC+6 office, and it is also what the
 * `no-direct-date` rule exists to prevent. `<input type="date">` already produces this format.
 *
 * `deadline` is optional per §13.3.1. When it IS present the `.refine()` below enforces
 * `deadline >= startDate` here, at the boundary, so the failure arrives as a parse error the
 * form can render rather than as the `deadline_after_start` CHECK violation — which is a raw
 * Postgres error, not an `AppError`, and therefore re-thrown by `actionResult` and redacted in
 * production (lib/action-result.ts). The CHECK constraint stays as the backstop for every
 * writer that does not come through this schema; this is a second gate, not a replacement.
 *
 * String comparison is correct for `YYYY-MM-DD`: the format is fixed-width and zero-padded, so
 * lexicographic and chronological order are the same. No `Date` is constructed, which keeps
 * the `no-direct-date` rule satisfied and the Dhaka-day semantics intact.
 */
export const CreateProjectInput = z
  .object({
    clientId: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    startDate: z.iso.date(),
    deadline: z.iso.date().optional(),
  })
  .refine((v) => v.deadline === undefined || v.deadline >= v.startDate, {
    message: 'Deadline must be on or after the start date',
    path: ['deadline'],
  });

export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/**
 * §13.3.3 input. `projectId` names the target; the four editable columns are optional and a
 * submit must carry at least one — an empty payload is a caller bug, not a no-op request
 * (the same `.refine()` convention as `UpdateEmployeeInput` / `UpdateClientInput`).
 *
 * `type` and `status` are deliberately absent, matching §13.3.3's field list exactly: status
 * moves only through §13.3.4 `archiveProject` / `unarchiveProject`, and §13.3.3 does not list
 * `type` as editable. Anything extra in the payload is stripped by this parse and can never
 * reach the UPDATE.
 *
 * `deadline` accepts `null` to clear it — the column is nullable and a project can lose its
 * deadline. `clientId`, `name` and `startDate` are all `NOT NULL`, so they can be changed but
 * never cleared, which is why only `deadline` carries `.nullable()`.
 */
export const UpdateProjectInput = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    startDate: z.iso.date().optional(),
    deadline: z.iso.date().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.clientId !== undefined ||
      v.startDate !== undefined ||
      v.deadline !== undefined,
    { message: 'Provide at least one field to update' },
  )
  // The same ordering rule as create, but it can only be applied when the payload carries BOTH
  // values. A partial edit that moves only the deadline has nothing to compare against — the
  // other side of the comparison is the stored row, which a schema cannot see. Those cases fall
  // through to the `deadline_after_start` CHECK, which remains the backstop.
  //
  // `null` is excluded deliberately: clearing the deadline can never violate the ordering.
  .refine(
    (v) =>
      v.startDate === undefined ||
      v.deadline === undefined ||
      v.deadline === null ||
      v.deadline >= v.startDate,
    { message: 'Deadline must be on or after the start date', path: ['deadline'] },
  );

export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

/** §13.3.4 input. */
export const ArchiveProjectInput = z.object({
  projectId: z.string().min(1),
});

export type ArchiveProjectInput = z.infer<typeof ArchiveProjectInput>;

/**
 * §13.3.4's reverse. Deliberately the same shape as archive and not a mirror of anything
 * larger: un-archiving restores `status` and nothing else, and it has nothing to redistribute
 * — the same reasoning as `ReactivateEmployeeInput`.
 */
export const UnarchiveProjectInput = z.object({
  projectId: z.string().min(1),
});

export type UnarchiveProjectInput = z.infer<typeof UnarchiveProjectInput>;

/**
 * §13.4.1 `createTask` input — the full field set, in contract order.
 *
 * `projectId`, `title` and `category` are the only required fields: §11.3 makes every other
 * column nullable or defaulted, and the Board's "+ Add task" inside a category column supplies
 * `category` as a pre-fill (PUL-403.1) rather than something the manager retypes.
 *
 * `dueDate` follows the same rule as the project dates above — a `YYYY-MM-DD` string end to
 * end, never a `Date`. `due_date` is a bare `date` column read as an Asia/Dhaka calendar day
 * (§11.0), and constructing a `Date` on this path is both how a due date silently slips a day
 * for a UTC+6 office and what the `no-direct-date` rule exists to prevent.
 *
 * `priority` is bound to the `task_priority` DB enum so the two can never drift — the same
 * reason `CreateEmployeeInput` binds `role` to `user_role`.
 *
 * `estimatedHours` arrives as a number and is capped to what `numeric(6, 2)` can physically
 * hold. Past 9999.99 Postgres raises a numeric overflow, which is a raw driver error rather
 * than an `AppError` — so `actionResult` re-throws it and production redacts it into an opaque
 * digest. Bounding it here turns that crash into a `VALIDATION` the form can render, exactly
 * as `CreateProjectInput`'s date `.refine()` does for the `deadline_after_start` CHECK.
 *
 * **The defaulted columns are optional on purpose.** `priority`, `qcRequired`, `proofRequired`
 * and `clientVisible` all carry column defaults (§11.3: medium / true / false / false), as do
 * `status` ('planned') and `version` (1) — neither of which is an input at all. A new task is
 * always `planned`, and §13.4.4 owns every move after that. An absent key here means "take the
 * column default", so §11.3 stays the single place those values are written down.
 *
 * `checklist` seeds the QC gate's initial items (§11.3.1). **It is not the subtask list** — a
 * different table, a different permission and different behaviour: the checklist gates
 * submission, subtasks never do (§9.6 ⁷, §16.8).
 */
export const CreateTaskInput = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  /** Retainer month number; absent for one-off work (§11.3). */
  month: z.number().int().optional(),
  description: z.string().optional(),
  /** Absent = unassigned/claimable. Never a super_admin (Amendment E) — checked in the action. */
  assigneeId: z.string().min(1).optional(),
  dueDate: z.iso.date().optional(),
  priority: z.enum(taskPriority.enumValues).optional(),
  estimatedHours: z.number().nonnegative().max(9999.99).optional(),
  expectedOutput: z.string().optional(),
  sopUrl: z.string().optional(),
  qcRequired: z.boolean().optional(),
  proofRequired: z.boolean().optional(),
  clientVisible: z.boolean().optional(),
  /** Another live task in the SAME project (§13.4.1) — checked in the action. */
  dependsOn: z.string().min(1).optional(),
  /** Seeds `task_checklist_items`; add/toggle/remove are §13.4.10 (PUL-405). */
  checklist: z.array(z.string().min(1)).optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

/**
 * §13.4.3 `assignTask` input — `{ taskId, assigneeId | null }`, where **null means unassign**.
 *
 * `assigneeId` is `.nullable()` but NOT `.optional()`: every payload must state the intent.
 * An absent key would be indistinguishable from "unassign" once it reached the UPDATE, and
 * those are opposite requests — one leaves the current assignee alone, the other clears them.
 * Making the field required forces the caller to say which.
 *
 * **No `version` field, deliberately.** §13.4.3's input is exactly these two fields; the
 * optimistic lock belongs to §13.4.2 `updateTaskFields`, whose whole point is that two managers
 * may be editing the same task's content at once. Re-assignment is last-writer-wins on a single
 * column, and adding a lock §13.4.3 does not specify would make the action reject a stale-form
 * assign that the contract says should succeed.
 */
export const AssignTaskInput = z.object({
  taskId: z.string().min(1),
  /** `null` unassigns — the task returns to the Board's "Unassigned" group (§13.4.3). */
  assigneeId: z.string().min(1).nullable(),
});

export type AssignTaskInput = z.infer<typeof AssignTaskInput>;
