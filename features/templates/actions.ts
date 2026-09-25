// features/templates/actions.ts — PUL-503
//
// Template CRUD, the hierarchy set (§13.3.6–13.3.7). Built to the 5-step shape from
// features/_example/actions.ts: validate → authorize → withTx → writeAudit → notify, inside the
// PUL-111 `actionResult` boundary. None of these notify.
//
// Permissions (§9.6 ⁹): `template.create` / `template.update` / `template.delete` are SA · TL · PM;
// HR reads only. `template.update` covers the whole hierarchy: months, categories, tasks and
// subtasks.
//
// ── Conventions shared by every action here ──────────────────────────────────────────────
// - **Audit is keyed on the TEMPLATE** (`resource_type = 'template'`, `resource_id` = the
//   template id), and each payload names the node it touched (`monthId`, `categoryId`,
//   `taskId`). One template's full editing history is then a single audit query, the way
//   `project_task.subtask_added` is keyed on its task.
// - **The template row is locked** (`SELECT … FOR UPDATE`) at the start of every hierarchy
//   edit. That serialises edits to one template, which is what keeps two things honest under
//   READ COMMITTED: `max(num) + 1` for a new month (otherwise `uq_month_num` fails the loser with
//   a raw constraint error), and the dependents check in `deleteTemplateTask` (otherwise a
//   concurrent edit could point an `after` rule at a task in the moment it is deleted).
// - **A soft-deleted template is NOT_FOUND** for every hierarchy edit. It no longer exists as
//   far as the editor is concerned.
// - **Every edit bumps `templates.updated_at`** from the clock port (no trigger, the `clients`
//   convention). A no-op edit bumps nothing and writes no audit row.
// - Positions are 1-based (as seeded, tests/seed-templates.ts); a new row goes at `max + 1`.
//
// Not in this file yet: §13.3.6b `updateTemplate` and the §13.3.7e inline subtask ops.
// (§13.3.7a `createTemplateMonths` landed with PUL-504.) The §14.4.4 modal edits subtasks through
// `updateTemplateTask`'s replacement list.

'use server';

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  templateCategories,
  templateMonths,
  templates,
  templateTasks,
  templateTaskSubtasks,
} from '../../db/schema';
import type { DueRule } from '../../db/schema/templates';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { withTx, type Tx } from '../../lib/mutation';
import { writeAudit } from '../audit/write-audit';
import { cascadeMonthDates, MONTH_NAMES } from './cascade';
import {
  AddTemplateCategoryInput,
  AddTemplateMonthInput,
  AddTemplateTaskInput,
  CreateTemplateInput,
  CreateTemplateMonthsInput,
  DeleteTemplateCategoryInput,
  DeleteTemplateInput,
  DeleteTemplateMonthInput,
  DeleteTemplateTaskInput,
  RenameTemplateCategoryInput,
  RenameTemplateMonthInput,
  UpdateTemplateTaskInput,
} from './schema';

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Lock a live template's row for the rest of the transaction, or NOT_FOUND. */
async function lockLiveTemplate(tx: Tx, templateId: string): Promise<void> {
  const [row] = await tx
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, templateId), isNull(templates.deletedAt)))
    .for('update');

  if (!row) throw new AppError('NOT_FOUND', 'Template not found');
}

/** Record that the template changed. Called only by an edit that actually wrote something. */
async function touchTemplate(tx: Tx, templateId: string): Promise<void> {
  await tx.update(templates).set({ updatedAt: clock.now() }).where(eq(templates.id, templateId));
}

/** A month and its template id, with the template locked; NOT_FOUND if either is gone. */
async function requireMonth(tx: Tx, monthId: string) {
  const [month] = await tx
    .select()
    .from(templateMonths)
    .where(eq(templateMonths.id, monthId))
    .limit(1);

  if (!month) throw new AppError('NOT_FOUND', 'Month not found');
  await lockLiveTemplate(tx, month.templateId);
  return month;
}

/** A category and its template id, with the template locked. */
async function requireCategory(tx: Tx, categoryId: string) {
  const [row] = await tx
    .select({ category: templateCategories, templateId: templateMonths.templateId })
    .from(templateCategories)
    .innerJoin(templateMonths, eq(templateMonths.id, templateCategories.monthId))
    .where(eq(templateCategories.id, categoryId))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Category not found');
  await lockLiveTemplate(tx, row.templateId);
  return row;
}

/** A task and its template id, with the template locked. */
async function requireTask(tx: Tx, taskId: string) {
  const [row] = await tx
    .select({ task: templateTasks, templateId: templateMonths.templateId })
    .from(templateTasks)
    .innerJoin(templateCategories, eq(templateCategories.id, templateTasks.categoryId))
    .innerJoin(templateMonths, eq(templateMonths.id, templateCategories.monthId))
    .where(eq(templateTasks.id, taskId))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Task not found');
  await lockLiveTemplate(tx, row.templateId);
  return row;
}

/** Every task's due rule in one template, keyed by task id. */
async function templateDueRules(tx: Tx, templateId: string): Promise<Map<string, DueRule>> {
  const rows = await tx
    .select({ id: templateTasks.id, dueRule: templateTasks.dueRule })
    .from(templateTasks)
    .innerJoin(templateCategories, eq(templateCategories.id, templateTasks.categoryId))
    .innerJoin(templateMonths, eq(templateMonths.id, templateCategories.monthId))
    .where(eq(templateMonths.templateId, templateId));

  return new Map(rows.map((r) => [r.id, r.dueRule]));
}

/**
 * §13.3.6: an `after` rule's `ref` must be a task in the SAME template, never the task itself,
 * and never close a cycle. Anything else is `GATE:bad_ref`, the reason §13.3.6 names (the same
 * one Start Project re-checks at clone time, §13.3.2).
 *
 * `taskId` is the task being written, or `null` for a new one (a new task has no dependents yet,
 * so it can close no cycle). A cycle is found by following the `after` chain from `ref`: each
 * task has at most one `ref`, so the chain either ends or comes back to `taskId`.
 */
async function assertValidRef(
  tx: Tx,
  templateId: string,
  taskId: string | null,
  rule: DueRule,
): Promise<void> {
  if (rule.kind !== 'after') return;

  const rules = await templateDueRules(tx, templateId);
  const bad = (why: string): never => {
    throw new AppError('GATE', why, { reason: 'bad_ref', ref: rule.ref });
  };

  if (rule.ref === taskId) bad('A task cannot depend on itself');
  if (!rules.has(rule.ref)) bad('A task can only depend on another task in the same template');

  const seen = new Set<string>();
  let cursor: string | undefined = rule.ref;
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === taskId) bad('That dependency would create a cycle');
    seen.add(cursor);
    const next = rules.get(cursor);
    cursor = next?.kind === 'after' ? next.ref : undefined;
  }
}

/**
 * Guard `GATE:task_has_dependents` for every hierarchy delete (task, category, month).
 *
 * `subtree` is the ids of every task the delete removes. The delete is blocked when a task
 * OUTSIDE the subtree has `due_rule = {kind: 'after', ref: <a task inside it>}`: that rule would
 * be left pointing at nothing, and the template could no longer start a project (§13.3.2
 * re-checks `bad_ref`). A dependent INSIDE the subtree does not block, since it is deleted
 * with its anchor.
 *
 * Runs on the caller's `tx`, after the template row is locked, so no new dependent can appear
 * between this check and the delete. The error names the first dependent, so the toast can
 * say which task to change first (§14.15), and carries all of them in `taskIds` / `titles`.
 */
async function assertNoOutsideDependents(
  tx: Tx,
  templateId: string,
  subtree: string[],
): Promise<void> {
  if (subtree.length === 0) return;

  const pointingIn = await tx
    .select({ id: templateTasks.id, title: templateTasks.title })
    .from(templateTasks)
    .innerJoin(templateCategories, eq(templateCategories.id, templateTasks.categoryId))
    .innerJoin(templateMonths, eq(templateMonths.id, templateCategories.monthId))
    .where(
      and(
        eq(templateMonths.templateId, templateId),
        sql`${templateTasks.dueRule}->>'kind' = 'after'`,
        inArray(sql`${templateTasks.dueRule}->>'ref'`, subtree),
      ),
    )
    .orderBy(templateTasks.title, templateTasks.id);

  const inside = new Set(subtree);
  const dependents = pointingIn.filter((d) => !inside.has(d.id));

  if (dependents.length > 0) {
    throw new AppError('GATE', `"${dependents[0]!.title}" is scheduled after a task being deleted`, {
      reason: 'task_has_dependents',
      taskIds: dependents.map((d) => d.id),
      titles: dependents.map((d) => d.title),
    });
  }
}

/** The ids of every task under one category. */
async function categoryTaskIds(tx: Tx, categoryId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: templateTasks.id })
    .from(templateTasks)
    .where(eq(templateTasks.categoryId, categoryId));
  return rows.map((r) => r.id);
}

/** The ids of every task under every category of one month. */
async function monthTaskIds(tx: Tx, monthId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: templateTasks.id })
    .from(templateTasks)
    .innerJoin(templateCategories, eq(templateCategories.id, templateTasks.categoryId))
    .where(eq(templateCategories.monthId, monthId));
  return rows.map((r) => r.id);
}

/** The next 1-based slot at one level: `max(column) + 1` over the rows `where` selects. */
async function nextSlot(
  tx: Tx,
  table: typeof templateMonths | typeof templateCategories | typeof templateTasks,
  column: AnyPgColumn,
  where: SQL,
): Promise<number> {
  // `max()` comes back from the driver as a string or null; Number() normalises it.
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${column}), 0) + 1` })
    .from(table)
    .where(where);
  return Number(next);
}

/** `numeric(6,2)` reads back as a string ("2.50"); the diff compares numbers. */
function hoursOf(stored: string | null): number | null {
  return stored === null ? null : Number(stored);
}

function hoursToColumn(hours: number | null): string | null {
  return hours === null ? null : hours.toFixed(2);
}

/**
 * A due rule in a fixed key order. jsonb hands keys back in its own order, so comparing two
 * rules as JSON text needs both built the same way first.
 */
function canonicalRule(rule: DueRule): DueRule {
  return rule.kind === 'after' ? { kind: 'after', ref: rule.ref } : { kind: rule.kind, n: rule.n };
}

// ── Template ────────────────────────────────────────────────────────────────────

/**
 * §13.3.6a `createTemplate` — MGR (`template.create`).
 *
 * Creates an EMPTY template, with no months; the UI then navigates to its detail view (§14.4.1),
 * where months are added. Returns the row, so the caller has the id.
 *
 * Notify: none.
 */
export async function createTemplate(input: CreateTemplateInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateTemplateInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.create');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const id = `tpl_${crypto.randomUUID()}`;
      const now = clock.now();

      const [row] = await tx
        .insert(templates)
        .values({
          id,
          name: parsed.name,
          description: parsed.description ?? null,
          category: parsed.category ?? null,
          roles: parsed.roles,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 4. AUDIT — same tx (§9.8 "template create").
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.created',
        resourceType: 'template',
        resourceId: id,
        before: null,
        after: row,
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.6c `deleteTemplate` — MGR (`template.delete`).
 *
 * A SOFT delete: `deleted_at` is set and the hierarchy stays in place. Running projects are
 * untouched, because they hold their own copies (§11.4 "Instantiation"). The template drops out of
 * `templatesListQuery` and `loadTemplateTree`.
 *
 * Deleting an already-deleted template is a no-op with no audit row, the `archiveClient`
 * convention: a double-click must not manufacture a second "deleted" event.
 *
 * Notify: none.
 */
export async function deleteTemplate(input: DeleteTemplateInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeleteTemplateInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.delete');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: templates.id, deletedAt: templates.deletedAt })
        .from(templates)
        .where(eq(templates.id, parsed.templateId))
        .for('update');

      if (!current) throw new AppError('NOT_FOUND', 'Template not found');
      if (current.deletedAt) return current;

      const now = clock.now();
      const [row] = await tx
        .update(templates)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(templates.id, parsed.templateId))
        .returning({ id: templates.id, deletedAt: templates.deletedAt });

      // 4. AUDIT — same tx (§9.8 "template delete").
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.deleted',
        resourceType: 'template',
        resourceId: parsed.templateId,
        before: { deletedAt: null },
        after: { deletedAt: now.toISOString() },
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

// ── Months ──────────────────────────────────────────────────────────────────────

/**
 * `addTemplateMonth` — MGR (`template.update`). **Not a §13 entry** (see the schema): adds ONE
 * blank month. `num` and `position` are both the template's current max + 1, so a template's
 * first month is Month 1. `name` defaults to `Month {num}`; the start date to 0 / 1.
 *
 * Notify: none.
 */
export async function addTemplateMonth(input: AddTemplateMonthInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = AddTemplateMonthInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT — the lock makes max + 1 safe (see the file header).
    return await withTx(async (tx) => {
      await lockLiveTemplate(tx, parsed.templateId);

      const inTemplate = eq(templateMonths.templateId, parsed.templateId);
      const num = await nextSlot(tx, templateMonths, templateMonths.num, inTemplate);
      const position = await nextSlot(tx, templateMonths, templateMonths.position, inTemplate);

      const [month] = await tx
        .insert(templateMonths)
        .values({
          id: `tm_${crypto.randomUUID()}`,
          templateId: parsed.templateId,
          num,
          name: parsed.name ?? `Month ${num}`,
          startMonth: parsed.startMonth ?? 0,
          startDay: parsed.startDay ?? 1,
          position,
        })
        .returning();

      await touchTemplate(tx, parsed.templateId);

      // 4. AUDIT — same tx (§9.8 "every template-hierarchy edit").
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.month_added',
        resourceType: 'template',
        resourceId: parsed.templateId,
        before: null,
        after: month,
      });

      return month;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7a `createTemplateMonths` — MGR (`template.update`). The Add Month wizard's save
 * (§14.4.3, PUL-504): a whole 12-month cycle in ONE transaction.
 *
 * - Month 1 is inserted fully populated: its categories, their tasks, the tasks' subtasks.
 * - Months 2–12 are empty scaffolds (no categories), dated by `cascadeMonthDates`: each keeps
 *   Month 1's day, clamped to what that month can hold (Jan 31 → Feb 29 → Mar 31).
 * - Numbering continues after any months the template already has: `num` and `position` start at
 *   `max + 1`, as `addTemplateMonth` does. The template row lock makes that safe.
 * - Each month is named `Month {num} — {Month name} {day}` (§13.3.7a / §14.4.2's format).
 * - Positions of categories, tasks and subtasks are 1-based, in input order.
 *
 * The wizard's due rules are `day` / `before_deadline` only (the schema refuses `after`), so no
 * `bad_ref` check is needed here.
 *
 * Audit: ONE `template.months_created` row, `after: { monthIds, taskCount, subtaskCount }`.
 * Returns `{ monthIds, firstNum, month1Tasks, month1Subtasks }`; `firstNum` is Month 1's `num`,
 * which the wizard's success toast names.
 *
 * Notify: none.
 */
export async function createTemplateMonths(input: CreateTemplateMonthsInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateTemplateMonthsInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      await lockLiveTemplate(tx, parsed.templateId);

      const inTemplate = eq(templateMonths.templateId, parsed.templateId);
      const firstNum = await nextSlot(tx, templateMonths, templateMonths.num, inTemplate);
      const firstPosition = await nextSlot(tx, templateMonths, templateMonths.position, inTemplate);

      const months = cascadeMonthDates(parsed.startMonth, parsed.startDay).map((start, i) => {
        const num = firstNum + i;
        return {
          id: `tm_${crypto.randomUUID()}`,
          templateId: parsed.templateId,
          num,
          name: `Month ${num} — ${MONTH_NAMES[start.month]} ${start.day}`,
          startMonth: start.month,
          startDay: start.day,
          position: firstPosition + i,
        };
      });
      const month1Id = months[0]!.id;

      // Month 1's contents, built in input order with 1-based positions at every level.
      const categoryRows: (typeof templateCategories.$inferInsert)[] = [];
      const taskRows: (typeof templateTasks.$inferInsert)[] = [];
      const subtaskRows: (typeof templateTaskSubtasks.$inferInsert)[] = [];

      parsed.month1.cats.forEach((cat, ci) => {
        const categoryId = `tcat_${crypto.randomUUID()}`;
        categoryRows.push({ id: categoryId, monthId: month1Id, name: cat.name, position: ci + 1 });

        cat.tasks.forEach((task, ti) => {
          const taskId = `tt_${crypto.randomUUID()}`;
          taskRows.push({
            id: taskId,
            categoryId,
            position: ti + 1,
            title: task.title,
            roleHint: task.roleHint || null,
            priority: task.priority,
            estHours: hoursToColumn(task.estHours ?? null),
            dueRule: canonicalRule(task.dueRule),
            qcRequired: task.qcRequired,
            proofRequired: task.proofRequired,
            clientVisible: task.clientVisible,
            sopUrl: task.sopUrl ?? null,
            expectedOutput: task.expectedOutput ?? null,
            checklist: task.checklist,
          });

          task.subtasks.forEach((title, si) => {
            subtaskRows.push({
              id: `tts_${crypto.randomUUID()}`,
              taskId,
              title,
              position: si + 1,
            });
          });
        });
      });

      // Parents before children: the FK chain is the hierarchy (§11.4).
      await tx.insert(templateMonths).values(months);
      await tx.insert(templateCategories).values(categoryRows);
      if (taskRows.length > 0) await tx.insert(templateTasks).values(taskRows);
      if (subtaskRows.length > 0) await tx.insert(templateTaskSubtasks).values(subtaskRows);

      await touchTemplate(tx, parsed.templateId);

      const monthIds = months.map((m) => m.id);

      // 4. AUDIT — same tx. One row for the whole cycle: it was one act.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.months_created',
        resourceType: 'template',
        resourceId: parsed.templateId,
        before: null,
        after: { monthIds, taskCount: taskRows.length, subtaskCount: subtaskRows.length },
      });

      return {
        monthIds,
        firstNum,
        month1Tasks: taskRows.length,
        month1Subtasks: subtaskRows.length,
      };
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7b `renameTemplateMonth` — MGR (`template.update`). Renaming to the current name is a
 * no-op: no write, no audit row.
 *
 * Notify: none.
 */
export async function renameTemplateMonth(input: RenameTemplateMonthInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = RenameTemplateMonthInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const month = await requireMonth(tx, parsed.monthId);
      if (month.name === parsed.name) return month;

      const [row] = await tx
        .update(templateMonths)
        .set({ name: parsed.name })
        .where(eq(templateMonths.id, month.id))
        .returning();

      await touchTemplate(tx, month.templateId);

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.month_renamed',
        resourceType: 'template',
        resourceId: month.templateId,
        before: { monthId: month.id, name: month.name },
        after: { monthId: month.id, name: parsed.name },
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7b `deleteTemplateMonth` — MGR (`template.update`). A hard delete: the FK cascade removes
 * the month's categories, tasks and subtasks in the same statement (§11.4), which is what the
 * §14.4.5 confirm dialog warns about.
 *
 * Guard `GATE:task_has_dependents` BEFORE the cascade (`assertNoOutsideDependents`): blocked
 * when a task in another month is scheduled `after` any task under this month's categories.
 * Dependents inside this month go with it and do not block.
 *
 * Notify: none.
 */
export async function deleteTemplateMonth(input: DeleteTemplateMonthInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeleteTemplateMonthInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const month = await requireMonth(tx, parsed.monthId);
      await assertNoOutsideDependents(tx, month.templateId, await monthTaskIds(tx, month.id));

      await tx.delete(templateMonths).where(eq(templateMonths.id, month.id));
      await touchTemplate(tx, month.templateId);

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.month_deleted',
        resourceType: 'template',
        resourceId: month.templateId,
        before: month,
        after: null,
      });

      return { id: month.id };
    });

    // 5. NOTIFY — none.
  });
}

// ── Categories ──────────────────────────────────────────────────────────────────

/**
 * §13.3.7c `addTemplateCategory` — MGR (`template.update`). Appended at the month's
 * `max(position) + 1`.
 *
 * Notify: none.
 */
export async function addTemplateCategory(input: AddTemplateCategoryInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = AddTemplateCategoryInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const month = await requireMonth(tx, parsed.monthId);

      const position = await nextSlot(
        tx,
        templateCategories,
        templateCategories.position,
        eq(templateCategories.monthId, month.id),
      );

      const [category] = await tx
        .insert(templateCategories)
        .values({
          id: `tcat_${crypto.randomUUID()}`,
          monthId: month.id,
          name: parsed.name,
          position,
        })
        .returning();

      await touchTemplate(tx, month.templateId);

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.category_added',
        resourceType: 'template',
        resourceId: month.templateId,
        before: null,
        after: category,
      });

      return category;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7c `renameTemplateCategory` — MGR (`template.update`). Same-name is a no-op.
 *
 * Notify: none.
 */
export async function renameTemplateCategory(input: RenameTemplateCategoryInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = RenameTemplateCategoryInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const { category, templateId } = await requireCategory(tx, parsed.categoryId);
      if (category.name === parsed.name) return category;

      const [row] = await tx
        .update(templateCategories)
        .set({ name: parsed.name })
        .where(eq(templateCategories.id, category.id))
        .returning();

      await touchTemplate(tx, templateId);

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.category_renamed',
        resourceType: 'template',
        resourceId: templateId,
        before: { categoryId: category.id, name: category.name },
        after: { categoryId: category.id, name: parsed.name },
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7c `deleteTemplateCategory` — MGR (`template.update`). Hard delete; tasks and subtasks
 * cascade.
 *
 * Guard `GATE:task_has_dependents` BEFORE the cascade, as for a month: blocked when a task
 * outside this category is scheduled `after` one of its tasks.
 *
 * Notify: none.
 */
export async function deleteTemplateCategory(input: DeleteTemplateCategoryInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeleteTemplateCategoryInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const { category, templateId } = await requireCategory(tx, parsed.categoryId);
      await assertNoOutsideDependents(tx, templateId, await categoryTaskIds(tx, category.id));

      await tx.delete(templateCategories).where(eq(templateCategories.id, category.id));
      await touchTemplate(tx, templateId);

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.category_deleted',
        resourceType: 'template',
        resourceId: templateId,
        before: category,
        after: null,
      });

      return { id: category.id };
    });

    // 5. NOTIFY — none.
  });
}

// ── Tasks ───────────────────────────────────────────────────────────────────────

/**
 * §13.3.7d `addTemplateTask` — MGR (`template.update`). Inserts the task at the category's
 * `max(position) + 1` and its subtasks (positions 1..n, in array order) in ONE transaction.
 *
 * An `after` rule is checked against the template's live tasks first (`GATE:bad_ref`).
 *
 * Notify: none.
 */
export async function addTemplateTask(input: AddTemplateTaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = AddTemplateTaskInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const { category, templateId } = await requireCategory(tx, parsed.categoryId);
      await assertValidRef(tx, templateId, null, parsed.dueRule);

      const position = await nextSlot(
        tx,
        templateTasks,
        templateTasks.position,
        eq(templateTasks.categoryId, category.id),
      );

      const [task] = await tx
        .insert(templateTasks)
        .values({
          id: `tt_${crypto.randomUUID()}`,
          categoryId: category.id,
          position,
          title: parsed.title,
          roleHint: parsed.roleHint ?? null,
          priority: parsed.priority,
          estHours: hoursToColumn(parsed.estHours ?? null),
          dueRule: canonicalRule(parsed.dueRule),
          qcRequired: parsed.qcRequired,
          proofRequired: parsed.proofRequired,
          clientVisible: parsed.clientVisible,
          sopUrl: parsed.sopUrl ?? null,
          expectedOutput: parsed.expectedOutput ?? null,
          checklist: parsed.checklist,
        })
        .returning();

      const subtasks =
        parsed.subtasks.length === 0
          ? []
          : await tx
              .insert(templateTaskSubtasks)
              .values(
                parsed.subtasks.map((s, i) => ({
                  id: `tts_${crypto.randomUUID()}`,
                  taskId: task.id,
                  title: s.title,
                  position: i + 1,
                })),
              )
              .returning();

      await touchTemplate(tx, templateId);

      const created = { ...task, subtasks };

      // 4. AUDIT — same tx. One row for the task and its subtasks: they were one act.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.task_added',
        resourceType: 'template',
        resourceId: templateId,
        before: null,
        after: created,
      });

      return created;
    });

    // 5. NOTIFY — none.
  });
}

/** A subtask as the audit diff records it: identity and title, in display order. */
type SubtaskSnapshot = { id: string; title: string };

/**
 * §13.3.7d `updateTemplateTask` — MGR (`template.update`). The §14.4.4 modal's one Save.
 *
 * **Fields** follow the PUL-203 partial-update convention: absent = leave, explicit `null` =
 * clear (`roleHint`, `estHours`). Only fields whose value actually changes are written and
 * audited.
 *
 * **Subtasks**, when the list is sent, are reconciled to it: listed ids are kept (renamed and
 * reordered to match), entries without an id are inserted, and existing subtasks missing from
 * the list are deleted. An id that is not one of THIS task's subtasks is a VALIDATION error:
 * a subtask cannot be moved between tasks through this door. The subtask diff is recorded as
 * the whole ordered `[{id, title}]` list before and after, and only when that list changed.
 * Resubmitting the same list does not renumber anything.
 *
 * A save that changes nothing returns the current task (with subtasks) and writes nothing: no
 * UPDATE, no `updated_at` bump, no audit row.
 *
 * Notify: none.
 */
export async function updateTemplateTask(input: UpdateTemplateTaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UpdateTemplateTaskInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const { task: current, templateId } = await requireTask(tx, parsed.templateTaskId);

      const currentSubtasks = await tx
        .select()
        .from(templateTaskSubtasks)
        .where(eq(templateTaskSubtasks.taskId, current.id))
        .orderBy(templateTaskSubtasks.position, templateTaskSubtasks.id);

      // ── Field diff ────────────────────────────────────────────────────────────
      // `consider` compares the stored value with the submitted one (both as the diff sees
      // them: hours as numbers, rules in canonical key order) and, when they differ, records
      // both sides and stages the column write.
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const changes: Partial<typeof templateTasks.$inferInsert> = {};

      const consider = <V>(field: string, was: V, next: V | undefined, write: () => void) => {
        if (next === undefined) return; // absent: leave alone
        if (JSON.stringify(was) === JSON.stringify(next)) return; // sent, but unchanged
        before[field] = was;
        after[field] = next;
        write();
      };

      consider('title', current.title, parsed.title, () => {
        changes.title = parsed.title;
      });
      consider('roleHint', current.roleHint, parsed.roleHint, () => {
        changes.roleHint = parsed.roleHint;
      });
      consider('priority', current.priority, parsed.priority, () => {
        changes.priority = parsed.priority;
      });
      consider('estHours', hoursOf(current.estHours), parsed.estHours, () => {
        changes.estHours = hoursToColumn(parsed.estHours ?? null);
      });
      const nextRule = parsed.dueRule && canonicalRule(parsed.dueRule);
      consider('dueRule', canonicalRule(current.dueRule), nextRule, () => {
        changes.dueRule = nextRule;
      });
      consider('qcRequired', current.qcRequired, parsed.qcRequired, () => {
        changes.qcRequired = parsed.qcRequired;
      });
      consider('proofRequired', current.proofRequired, parsed.proofRequired, () => {
        changes.proofRequired = parsed.proofRequired;
      });
      consider('clientVisible', current.clientVisible, parsed.clientVisible, () => {
        changes.clientVisible = parsed.clientVisible;
      });
      consider('sopUrl', current.sopUrl, parsed.sopUrl, () => {
        changes.sopUrl = parsed.sopUrl;
      });
      consider('expectedOutput', current.expectedOutput, parsed.expectedOutput, () => {
        changes.expectedOutput = parsed.expectedOutput;
      });
      consider('checklist', current.checklist, parsed.checklist, () => {
        changes.checklist = parsed.checklist;
      });

      // Only a CHANGED `after` rule is re-validated: an unchanged one was checked when written.
      if (changes.dueRule) {
        await assertValidRef(tx, templateId, current.id, changes.dueRule);
      }

      // ── Subtask reconcile ─────────────────────────────────────────────────────
      const wasList: SubtaskSnapshot[] = currentSubtasks.map((s) => ({ id: s.id, title: s.title }));
      let subtasksChanged = false;

      if (parsed.subtasks !== undefined) {
        const existing = new Map(currentSubtasks.map((s) => [s.id, s]));
        const kept = new Set<string>();
        for (const s of parsed.subtasks) {
          if (s.id === undefined) continue;
          if (!existing.has(s.id) || kept.has(s.id)) {
            throw new AppError('VALIDATION', 'A subtask in the list does not belong to this task');
          }
          kept.add(s.id);
        }

        const isSame =
          parsed.subtasks.length === wasList.length &&
          parsed.subtasks.every(
            (s, i) => s.id === wasList[i]!.id && s.title === wasList[i]!.title,
          );

        if (!isSame) {
          subtasksChanged = true;

          // Delete the ones the modal removed.
          for (const s of currentSubtasks) {
            if (!kept.has(s.id)) {
              await tx.delete(templateTaskSubtasks).where(eq(templateTaskSubtasks.id, s.id));
            }
          }

          // Then walk the list in order: rename / reposition the kept ones, insert the new ones.
          const nowList: SubtaskSnapshot[] = [];
          for (const [i, s] of parsed.subtasks.entries()) {
            const position = i + 1;
            if (s.id !== undefined) {
              const was = existing.get(s.id)!;
              if (was.title !== s.title || was.position !== position) {
                await tx
                  .update(templateTaskSubtasks)
                  .set({ title: s.title, position })
                  .where(eq(templateTaskSubtasks.id, s.id));
              }
              nowList.push({ id: s.id, title: s.title });
            } else {
              const id = `tts_${crypto.randomUUID()}`;
              await tx
                .insert(templateTaskSubtasks)
                .values({ id, taskId: current.id, title: s.title, position });
              nowList.push({ id, title: s.title });
            }
          }

          before.subtasks = wasList;
          after.subtasks = nowList;
        }
      }

      // Nothing moved: no write, no bump, no audit row.
      if (Object.keys(changes).length === 0 && !subtasksChanged) {
        return { ...current, subtasks: currentSubtasks };
      }

      const task =
        Object.keys(changes).length === 0
          ? current
          : (
              await tx
                .update(templateTasks)
                .set(changes)
                .where(eq(templateTasks.id, current.id))
                .returning()
            )[0]!;

      const subtasks = await tx
        .select()
        .from(templateTaskSubtasks)
        .where(eq(templateTaskSubtasks.taskId, current.id))
        .orderBy(templateTaskSubtasks.position, templateTaskSubtasks.id);

      await touchTemplate(tx, templateId);

      // 4. AUDIT — same tx. before/after carry only what changed, plus the task's id.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.task_updated',
        resourceType: 'template',
        resourceId: templateId,
        before: { taskId: current.id, ...before },
        after: { taskId: current.id, ...after },
      });

      return { ...task, subtasks };
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.3.7d `deleteTemplateTask` — MGR (`template.update`). Hard delete; subtasks cascade.
 *
 * Guard `GATE:task_has_dependents` (`assertNoOutsideDependents`, subtree = this one task): no
 * other task in the template may be scheduled `after` it.
 *
 * Notify: none.
 */
export async function deleteTemplateTask(input: DeleteTemplateTaskInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeleteTemplateTaskInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('template.update');

    // 3. TRANSACT — the template lock keeps a new dependent from appearing mid-check.
    return await withTx(async (tx) => {
      const { task, templateId } = await requireTask(tx, parsed.templateTaskId);
      await assertNoOutsideDependents(tx, templateId, [task.id]);

      const subtasks = await tx
        .select()
        .from(templateTaskSubtasks)
        .where(eq(templateTaskSubtasks.taskId, task.id))
        .orderBy(templateTaskSubtasks.position, templateTaskSubtasks.id);

      await tx.delete(templateTasks).where(eq(templateTasks.id, task.id));
      await touchTemplate(tx, templateId);

      // 4. AUDIT — same tx. The snapshot includes the subtasks the cascade removed.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'template.task_deleted',
        resourceType: 'template',
        resourceId: templateId,
        before: { ...task, subtasks },
        after: null,
      });

      return { id: task.id };
    });

    // 5. NOTIFY — none.
  });
}
