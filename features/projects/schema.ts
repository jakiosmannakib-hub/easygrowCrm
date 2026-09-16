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
 * `deadline` is optional per §13.3.1. The `deadline >= start_date` rule is NOT checked here:
 * it is the `deadline_after_start` CHECK constraint in migration 0005, enforced by the database
 * for every writer. A zod `.refine()` would duplicate it and could only cover the create path,
 * where both values happen to be present in one payload.
 */
export const CreateProjectInput = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  startDate: z.iso.date(),
  deadline: z.iso.date().optional(),
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
  );

export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;
