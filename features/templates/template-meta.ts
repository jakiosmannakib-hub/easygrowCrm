// features/templates/template-meta.ts — PUL-503 Stage 2
//
// The four numbers on a template card's footer and the detail header (§14.4.1 / §14.4.2):
// `N tasks · N months · N roles · N QC gates`, and the role pills beside them. Pure and
// client-safe; shared by the grid, the detail header and the Add Month wizard (PUL-504).
//
// Tasks are counted through `tplAllTasks`, the only flattener (§16.7). Nothing here keeps or
// stores a count: every number is derived from the tree on demand.
//
// ROLES are the roles the template's TASKS actually use (§14.4.1 "roles used by any task in this
// template"), not the declared `templates.roles` column. That column is the role PALETTE the task
// modal offers (§3.3.5), and the two can differ in both directions: a seeded or older task may
// carry a role the palette does not list, and a declared role may be used by no task yet.

import { tplAllTasks, type TemplateTree } from './hierarchy';

export interface TemplateMeta {
  /** Every task in every category of every month. */
  tasks: number;
  /** `tree.months.length`: blank scaffold months count too. */
  months: number;
  /** Distinct roles used by the template's tasks (`templateRoles(tree).length`). */
  roles: number;
  /** Tasks with `qc_required = true`, i.e. tasks that go through review. */
  qcGates: number;
}

/**
 * The distinct non-blank `role_hint` values across every task, in walk order (month → category
 * → task position), so the pills read in the order the roles first appear in the template.
 */
export function templateRoles(tree: TemplateTree): string[] {
  const seen = new Set<string>();
  for (const task of tplAllTasks(tree)) {
    const role = task.roleHint?.trim();
    if (role) seen.add(role);
  }
  return [...seen];
}

/** Derive the card/header counts from a template tree. */
export function templateMeta(tree: TemplateTree): TemplateMeta {
  const tasks = tplAllTasks(tree);
  return {
    tasks: tasks.length,
    months: tree.months.length,
    roles: templateRoles(tree).length,
    qcGates: tasks.filter((t) => t.qcRequired).length,
  };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The footer row as text: `12 tasks · 2 months · 4 roles · 9 QC gates`. */
export function formatTemplateMeta(meta: TemplateMeta): string {
  return [
    count(meta.tasks, 'task', 'tasks'),
    count(meta.months, 'month', 'months'),
    count(meta.roles, 'role', 'roles'),
    count(meta.qcGates, 'QC gate', 'QC gates'),
  ].join(' · ');
}
