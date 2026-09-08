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
