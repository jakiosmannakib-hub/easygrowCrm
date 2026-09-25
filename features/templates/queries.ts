// features/templates/queries.ts — PUL-503
//
// Reads for the templates slice. No 'use server' and no writes — queries may run anywhere; only
// actions.ts writes (CLAUDE.md §2).
//
// Like the employees and clients queries, these do NOT authorize: the permission check
// (`template.read`, §9.6 ⁹) lives at the call site, meaning the route guard for /templates or
// the consuming action.
//
// Both reads return the NESTED tree (§16.7). Nothing here flattens: a caller that needs a task
// list, such as the grid card's `N tasks · N QC gates`, runs `tplAllTasks` on the tree.

import { asc, eq, inArray, isNull, and } from 'drizzle-orm';
import { db } from '../../db';
import {
  templateCategories,
  templateMonths,
  templates,
  templateTasks,
  templateTaskSubtasks,
} from '../../db/schema';
import type { Executor } from '../../lib/mutation';
import type {
  TemplateCategoryNode,
  TemplateMonthNode,
  TemplateTaskNode,
  TemplateTree,
} from './hierarchy';

type TemplateRow = typeof templates.$inferSelect;

/** Push `item` onto the list for `key`, creating it. Keeps each level's query order. */
function pushTo<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/**
 * Hang the four child levels under `rows`, in one query per level (five in all, whatever the
 * number of templates). Every level is read ordered by `position`, with `id` as a tiebreak so
 * the order is total, and the nesting keeps that order.
 */
async function assembleTrees(executor: Executor, rows: TemplateRow[]): Promise<TemplateTree[]> {
  if (rows.length === 0) return [];

  const months = await executor
    .select()
    .from(templateMonths)
    .where(
      inArray(
        templateMonths.templateId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(templateMonths.position), asc(templateMonths.id));

  const categories =
    months.length === 0
      ? []
      : await executor
          .select()
          .from(templateCategories)
          .where(
            inArray(
              templateCategories.monthId,
              months.map((m) => m.id),
            ),
          )
          .orderBy(asc(templateCategories.position), asc(templateCategories.id));

  const tasks =
    categories.length === 0
      ? []
      : await executor
          .select()
          .from(templateTasks)
          .where(
            inArray(
              templateTasks.categoryId,
              categories.map((c) => c.id),
            ),
          )
          .orderBy(asc(templateTasks.position), asc(templateTasks.id));

  const subtasks =
    tasks.length === 0
      ? []
      : await executor
          .select()
          .from(templateTaskSubtasks)
          .where(
            inArray(
              templateTaskSubtasks.taskId,
              tasks.map((t) => t.id),
            ),
          )
          .orderBy(asc(templateTaskSubtasks.position), asc(templateTaskSubtasks.id));

  const subtasksByTask = new Map<string, TemplateTaskNode['subtasks']>();
  for (const s of subtasks) pushTo(subtasksByTask, s.taskId, s);

  const tasksByCategory = new Map<string, TemplateTaskNode[]>();
  for (const t of tasks) {
    pushTo(tasksByCategory, t.categoryId, { ...t, subtasks: subtasksByTask.get(t.id) ?? [] });
  }

  const categoriesByMonth = new Map<string, TemplateCategoryNode[]>();
  for (const c of categories) {
    pushTo(categoriesByMonth, c.monthId, { ...c, tasks: tasksByCategory.get(c.id) ?? [] });
  }

  const monthsByTemplate = new Map<string, TemplateMonthNode[]>();
  for (const m of months) {
    pushTo(monthsByTemplate, m.templateId, {
      ...m,
      categories: categoriesByMonth.get(m.id) ?? [],
    });
  }

  return rows.map((r) => ({ ...r, months: monthsByTemplate.get(r.id) ?? [] }));
}

/**
 * One template as its nested tree (months → categories → tasks → subtasks, each level in
 * `position` order), or `null` when it does not exist or is soft-deleted.
 *
 * `executor` comes FIRST (the `getClientProjectUsage` convention) so an action can read the tree
 * on its `tx`: Start Project (PUL-506) must clone the same snapshot it validated.
 */
export async function loadTemplateTree(
  executor: Executor,
  templateId: string,
): Promise<TemplateTree | null> {
  const [row] = await executor
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), isNull(templates.deletedAt)))
    .limit(1);

  if (!row) return null;

  const [tree] = await assembleTrees(executor, [row]);
  return tree ?? null;
}

/**
 * Every live (not soft-deleted) template as a full tree, name-ordered, for the §14.4.1 grid.
 *
 * It returns trees rather than header rows plus counts: the card's footer
 * (`N tasks · N months · N roles · N QC gates`) is derived from the tree, tasks and QC gates
 * via `tplAllTasks`, so no count is computed in SQL and no flat task list exists beside the
 * hierarchy (§16.7). The agency has a handful of templates with a few dozen tasks each, and the
 * whole set costs five queries.
 */
export async function templatesListQuery(): Promise<TemplateTree[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(isNull(templates.deletedAt))
    .orderBy(asc(templates.name), asc(templates.id));

  return assembleTrees(db, rows);
}
