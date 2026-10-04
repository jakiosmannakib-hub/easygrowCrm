// features/attendance/schema.ts
//
// Zod inputs for the attendance actions (§13.5). Enums are bound to the DB enums so the two
// can never drift.

import { z } from 'zod';
import { taskPriority, workType } from '../../db/schema/enums';

/** The most plan rows one sign-in may carry. */
export const MAX_PLAN_ROWS = 30;

/**
 * One daily-plan row (§11.6 `daily_tasks`). `projectTaskId` links it to a project task; a
 * linked row's title is replaced by the task's own title on insert. `estimatedHours` is decimal
 * hours, capped to what `numeric(6, 2)` holds, as in `CreateTaskInput`.
 */
export const PlanRowInput = z.object({
  title: z.string().trim().min(1),
  clientId: z.string().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  priority: z.enum(taskPriority.enumValues).default('medium'),
  estimatedHours: z.number().nonnegative().max(9999.99).optional(),
  expectedOutput: z.string().trim().min(1).optional(),
  projectTaskId: z.string().min(1).optional(),
});

/**
 * §13.5.1 `signIn`. An empty plan is allowed. Duplicate `projectTaskId`s are refused by the
 * action as `VALIDATION` (an `AppError`), not here: a Zod failure is re-thrown by
 * `actionResult`, and a duplicate is an expected mistake the UI should be told about.
 */
export const SignInInput = z.object({
  workType: z.enum(workType.enumValues),
  plan: z.array(PlanRowInput).max(MAX_PLAN_ROWS),
});
export type SignInInput = z.input<typeof SignInInput>;
