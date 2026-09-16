// features/projects/schema.ts
//
// Input schemas for the projects slice, kept OUT of actions.ts for the same reason as
// features/employees/schema.ts and features/clients/schema.ts: actions.ts carries 'use server',
// and such a file may only export async functions — so a form that wants to reuse the schema
// for inline validation cannot import it from there. The action still re-parses as the real
// gate (§9.5 rule 2: the UI hides, the API refuses).

import { z } from 'zod';

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
