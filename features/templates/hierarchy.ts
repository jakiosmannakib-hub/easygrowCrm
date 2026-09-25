// features/templates/hierarchy.ts — PUL-502, §14.4 / §16.7
//
// The template tree as types, and `tplAllTasks`, the one function that flattens it.
//
// Pure: no DB, no clock, no I/O, and no `authorize()` (it is not an action). The schema import is
// type-only, so this module pulls in no runtime code and is safe on client and server alike.

import type {
  templateCategories,
  templateMonths,
  templates,
  templateTasks,
  templateTaskSubtasks,
} from '../../db/schema';

/** A subtask blueprint (§11.4). No `done` flag: "done" is a live-task concept. */
export type TemplateSubtaskNode = typeof templateTaskSubtasks.$inferSelect;

export type TemplateTaskNode = typeof templateTasks.$inferSelect & {
  subtasks: TemplateSubtaskNode[];
};

export type TemplateCategoryNode = typeof templateCategories.$inferSelect & {
  tasks: TemplateTaskNode[];
};

export type TemplateMonthNode = typeof templateMonths.$inferSelect & {
  categories: TemplateCategoryNode[];
};

/** Template → Month → Category → Task → Subtask (Amendment J, §11.4). */
export type TemplateTree = typeof templates.$inferSelect & {
  months: TemplateMonthNode[];
};

/**
 * One task with its parents' identity attached. The underscore fields are *derived by the walk*
 * and exist only on this return value: they are never stored, and never kept alongside the tree.
 */
export type FlatTemplateTask = TemplateTaskNode & {
  _monthId: string;
  _monthNum: number;
  _monthName: string;
  _catId: string;
  _catName: string;
};

/** A shallow copy sorted by `position` ascending. The input array is never reordered. */
function byPosition<T extends { position: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

/**
 * **The canonical and ONLY template flattener (§16.7).** Every caller that needs a template's
 * tasks as a list — Start Project's clone (PUL-506), the due-rule resolver (PUL-505), the
 * template cards' counts (§14.4.1) — goes through this function. **No parallel flat cache may
 * exist**, whether a stored `tasks[]`, a memoized list kept beside the tree, or a denormalized
 * column. The flat-list-plus-hierarchy pattern is exactly what §16.7 records as three sessions
 * of pain.
 *
 * Walks months → categories → tasks, each level in ascending `position`. Stored array order is
 * not trusted, because positions are the order the editor and the clone agree on. Each task is
 * returned as a new object: the task node spread (its own `subtasks` array included), plus
 * `_monthId` / `_monthNum` / `_monthName` / `_catId` / `_catName` from its real parents.
 *
 * The input tree is never mutated: every level is sorted on a copy.
 */
export function tplAllTasks(tree: TemplateTree): FlatTemplateTask[] {
  const out: FlatTemplateTask[] = [];
  for (const month of byPosition(tree.months)) {
    for (const cat of byPosition(month.categories)) {
      for (const task of byPosition(cat.tasks)) {
        out.push({
          ...task,
          _monthId: month.id,
          _monthNum: month.num,
          _monthName: month.name,
          _catId: cat.id,
          _catName: cat.name,
        });
      }
    }
  }
  return out;
}
