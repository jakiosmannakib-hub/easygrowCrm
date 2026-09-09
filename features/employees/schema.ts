// features/employees/schema.ts
//
// Input schemas for the employees slice, kept OUT of actions.ts on purpose: actions.ts
// carries 'use server', and a client component may only import async functions from such a
// file. The modal reuses this schema for inline validation, so it has to live somewhere both
// sides can import — here.
//
// The server action still parses it as the real gate (§9.5 rule 2: the UI hides, the API
// refuses); the client copy only saves a round trip on obvious mistakes.

import { z } from 'zod';
import { userRole } from '../../db/schema/enums';

/**
 * §13.1.1 input. `role` is bound to the DB enum so the two can never drift.
 *
 * `joinDate` is a plain calendar date (§11.0 — `date` columns are read as Asia/Dhaka days),
 * so it stays a `YYYY-MM-DD` string end to end and never becomes a `Date` that a timezone
 * could shift across a day boundary. `<input type="date">` produces exactly this format.
 */
export const CreateEmployeeInput = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(userRole.enumValues),
  title: z.string().optional(),
  department: z.string().optional(),
  joinDate: z.iso.date().optional(),
});

export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInput>;

/**
 * §13.1.2 input. `userId` names the target; the four editable columns are all optional and a
 * submit must carry at least one of them — an empty payload is a caller bug, not a no-op
 * request. `email` and `role` are deliberately absent: email is immutable, and role moves
 * only through §13.1.3 `changeRole` (SA-only, with the min-2-managers guard). Anything extra
 * in the payload is stripped by this parse and can never reach the UPDATE.
 *
 * The three nullable fields accept `null` to clear them — the columns are nullable and the
 * edit form needs a way to empty a title or department. `joinDate` keeps the same
 * `YYYY-MM-DD` string treatment as §13.1.1 (§11.0).
 */
export const UpdateEmployeeInput = z
  .object({
    userId: z.string().min(1),
    name: z.string().min(1).optional(),
    title: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    joinDate: z.iso.date().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.title !== undefined ||
      v.department !== undefined ||
      v.joinDate !== undefined,
    { message: 'Provide at least one field to update' },
  );

export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeInput>;

/**
 * §13.1.3 input. Deliberately just the target and the new role — everything §13.1.3 guards
 * against (self-demotion, the §9.7-5 manager floor, Amendment E) is a runtime condition the
 * action checks against live rows, not a shape a parse can express.
 */
export const ChangeRoleInput = z.object({
  userId: z.string().min(1),
  role: z.enum(userRole.enumValues),
});

export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;
