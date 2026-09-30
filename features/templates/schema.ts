// features/templates/schema.ts — PUL-503
//
// Input schemas for the templates slice (§13.3.6–13.3.7), kept OUT of actions.ts for the same
// reason as features/employees/schema.ts: actions.ts carries 'use server', and the template
// editor's modals (PUL-503 Stage 2) reuse these for inline validation. The server action still
// parses them as the real gate (§9.5 rule 2).
//
// Titles may carry `{{ClientName}}`-style tokens (§3.3.3). They are stored verbatim: nothing
// here validates or expands a token; Start Project (PUL-506) does the substitution.

import { z } from 'zod';
import { taskPriority } from '../../db/schema/enums';
import type { DueRule } from '../../db/schema/templates';

/** A required display string. Trimmed, so "   " is rejected rather than stored as a blank name. */
const Title = z.string().trim().min(1);

/**
 * The three §11.4 `due_rule` shapes (Amendment D). The TYPE is declared once, in
 * db/schema/templates.ts (the jsonb column's `$type`), and `hierarchy.ts` reaches it through
 * the row types. This schema is checked against that type below rather than redeclaring it, so
 * the parser and the column can never drift.
 *
 * `after.ref` is only shape-checked here. That it names a task in the SAME template, is not
 * the task itself, and closes no cycle is a live-rows question the action answers in its
 * transaction (`GATE:bad_ref`, §13.3.6).
 */
export const dueRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('day'), n: z.number().int().min(0) }),
  z.object({ kind: z.literal('before_deadline'), n: z.number().int().min(0) }),
  z.object({ kind: z.literal('after'), ref: z.string().min(1) }),
]);

export type DueRuleInput = z.infer<typeof dueRuleSchema>;

// Compile-time proof that the parser and the column type are the same union, both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const dueRuleMatchesColumn: Same<DueRuleInput, DueRule> = true;
void dueRuleMatchesColumn;

const Priority = z.enum(taskPriority.enumValues);

/** Hours are `numeric(6,2)`: non-negative, and small enough to fit the column. */
const EstHours = z.number().min(0).max(9999.99).nullable();

// ── Template ────────────────────────────────────────────────────────────────────

/** §13.3.6a. Creates an EMPTY template: no months (§14.4.1 → straight into detail). */
export const CreateTemplateInput = z.object({
  name: Title,
  description: z.string().optional(),
  category: z.string().optional(),
  roles: z.array(Title).default([]),
});
export type CreateTemplateInput = z.input<typeof CreateTemplateInput>;

/** §13.3.6c. Soft delete. */
export const DeleteTemplateInput = z.object({ templateId: z.string().min(1) });
export type DeleteTemplateInput = z.infer<typeof DeleteTemplateInput>;

// ── Months ──────────────────────────────────────────────────────────────────────

/**
 * `addTemplateMonth`: ONE blank month. NOT a §13 entry: §13.3.7a's only month-creating action
 * is `createTemplateMonths`, the 12-month wizard (PUL-504). Added for PUL-503 on the ticket's
 * instruction and flagged for a §13 row. `name` defaults to `Month {num}`; the start date to
 * January 1 (0 / 1).
 */
export const AddTemplateMonthInput = z.object({
  templateId: z.string().min(1),
  name: Title.optional(),
  startMonth: z.number().int().min(0).max(11).optional(),
  startDay: z.number().int().min(1).max(31).optional(),
});
export type AddTemplateMonthInput = z.infer<typeof AddTemplateMonthInput>;

/**
 * The Add Month wizard's due rules (§14.4.3): `day` and `before_deadline` only. `after` needs a
 * task to point at, and the wizard's tasks do not exist yet when it is filled in; dependency
 * rules are set afterwards in the task modal (§14.4.2 "dependency-based rules deferred to
 * per-task edit").
 */
export const wizardDueRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('day'), n: z.number().int().min(0) }),
  z.object({ kind: z.literal('before_deadline'), n: z.number().int().min(0) }),
]);

/** One Month 1 task in the wizard. Same columns as `addTemplateTask`, minus an `after` rule. */
const WizardTaskInput = z.object({
  title: Title,
  roleHint: z.string().trim().optional(),
  priority: Priority.default('medium'),
  estHours: z.number().min(0).max(9999.99).optional(),
  dueRule: wizardDueRuleSchema,
  // Amendment M (PUL-416): QA is mandatory. Only `true` (or absent) is accepted; the DB CHECK
  // `template_tasks_qc_required_check` backs it.
  qcRequired: z.literal(true).default(true),
  proofRequired: z.boolean().default(false),
  clientVisible: z.boolean().default(false),
  sopUrl: z.string().optional(),
  expectedOutput: z.string().optional(),
  checklist: z.array(Title).default([]),
  /** Titles, in display order. */
  subtasks: z.array(Title).default([]),
});

/**
 * §13.3.7a `createTemplateMonths`: the Add Month wizard's save. Month 1 fully populated
 * (at least one category), then Months 2–12 as empty scaffolds with cascaded dates.
 *
 * `startDay` is 1..31 whatever the month; Month 1 keeps it as given (see `cascadeMonthDates`).
 */
export const CreateTemplateMonthsInput = z.object({
  templateId: z.string().min(1),
  startMonth: z.number().int().min(0).max(11),
  startDay: z.number().int().min(1).max(31),
  month1: z.object({
    cats: z
      .array(
        z.object({
          name: Title,
          tasks: z.array(WizardTaskInput).default([]),
        }),
      )
      .min(1),
  }),
});
export type CreateTemplateMonthsInput = z.input<typeof CreateTemplateMonthsInput>;

/** §13.3.7b. */
export const RenameTemplateMonthInput = z.object({ monthId: z.string().min(1), name: Title });
export type RenameTemplateMonthInput = z.infer<typeof RenameTemplateMonthInput>;

/** §13.3.7b. Cascades categories → tasks → subtasks (the FK chain, §11.4). */
export const DeleteTemplateMonthInput = z.object({ monthId: z.string().min(1) });
export type DeleteTemplateMonthInput = z.infer<typeof DeleteTemplateMonthInput>;

// ── Categories ──────────────────────────────────────────────────────────────────

/** §13.3.7c. */
export const AddTemplateCategoryInput = z.object({ monthId: z.string().min(1), name: Title });
export type AddTemplateCategoryInput = z.infer<typeof AddTemplateCategoryInput>;

/** §13.3.7c. */
export const RenameTemplateCategoryInput = z.object({
  categoryId: z.string().min(1),
  name: Title,
});
export type RenameTemplateCategoryInput = z.infer<typeof RenameTemplateCategoryInput>;

/** §13.3.7c. Cascades tasks → subtasks. */
export const DeleteTemplateCategoryInput = z.object({ categoryId: z.string().min(1) });
export type DeleteTemplateCategoryInput = z.infer<typeof DeleteTemplateCategoryInput>;

// ── Tasks ───────────────────────────────────────────────────────────────────────

/**
 * A subtask as the §14.4.4 modal submits it. `id` is present for a row that already exists and
 * absent for one typed into the modal since it opened. Subtasks are identified by id, never by
 * position (CLAUDE.md §5).
 */
export const TemplateSubtaskInput = z.object({
  id: z.string().min(1).optional(),
  title: Title,
});
export type TemplateSubtaskInput = z.infer<typeof TemplateSubtaskInput>;

/**
 * §13.3.7d `addTemplateTask`. The field set is §13.3.7a's task shape (the §14.4.4 modal's
 * fields). `subtasks` are titles in display order; a new task has no existing subtask ids.
 */
export const AddTemplateTaskInput = z.object({
  categoryId: z.string().min(1),
  title: Title,
  roleHint: z.string().nullable().optional(),
  priority: Priority.default('medium'),
  estHours: EstHours.optional(),
  dueRule: dueRuleSchema,
  qcRequired: z.literal(true).default(true),
  proofRequired: z.boolean().default(false),
  // PUL-503 Stage 3b: the remaining §11.4 task columns the §14.4.4 modal edits.
  clientVisible: z.boolean().default(false),
  sopUrl: z.string().nullable().optional(),
  expectedOutput: z.string().nullable().optional(),
  checklist: z.array(Title).default([]),
  subtasks: z.array(z.object({ title: Title })).default([]),
});
export type AddTemplateTaskInput = z.input<typeof AddTemplateTaskInput>;

/**
 * §13.3.7d `updateTemplateTask`. The partial-update convention (PUL-203): an ABSENT field is
 * left alone; an explicit `null` clears a nullable one (`roleHint`, `estHours`, `sopUrl`,
 * `expectedOutput`).
 *
 * There is deliberately no `categoryId`: a task stays in the category it was added to. Moving a
 * task between categories is not in PUL-503's scope.
 *
 * `subtasks`, when present, is the FULL replacement list (§13.3.7d, §14.4.4 "one Save writes
 * the task and its subtasks together"): rows with an `id` are kept (renamed/reordered as
 * submitted), rows without one are created, and existing rows missing from the list are
 * deleted. When absent, the subtasks are not touched.
 */
export const UpdateTemplateTaskInput = z.object({
  templateTaskId: z.string().min(1),
  title: Title.optional(),
  roleHint: z.string().nullable().optional(),
  priority: Priority.optional(),
  estHours: EstHours.optional(),
  dueRule: dueRuleSchema.optional(),
  qcRequired: z.literal(true).optional(),
  proofRequired: z.boolean().optional(),
  clientVisible: z.boolean().optional(),
  sopUrl: z.string().nullable().optional(),
  expectedOutput: z.string().nullable().optional(),
  checklist: z.array(Title).optional(),
  subtasks: z.array(TemplateSubtaskInput).optional(),
});
export type UpdateTemplateTaskInput = z.infer<typeof UpdateTemplateTaskInput>;

/** §13.3.7d. Blocked while another task's `after` rule points at it (`GATE:task_has_dependents`). */
export const DeleteTemplateTaskInput = z.object({ templateTaskId: z.string().min(1) });
export type DeleteTemplateTaskInput = z.infer<typeof DeleteTemplateTaskInput>;
