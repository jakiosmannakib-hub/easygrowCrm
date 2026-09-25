// features/templates/template-meta.ts — PUL-503 Stage 2
//
// The four numbers on a template card's footer and the detail header (§14.4.1 / §14.4.2):
// `N tasks · N months · N roles · N QC gates`. Pure and client-safe; shared by the grid, the
// detail header (PUL-503 Stage 3) and the Add Month wizard (PUL-504).
//
// Tasks are counted through `tplAllTasks`, the only flattener (§16.7). Nothing here keeps or
// stores a count: every number is derived from the tree on demand.

import { tplAllTasks, type TemplateTree } from './hierarchy';

export interface TemplateMeta {
  /** Every task in every category of every month. */
  tasks: number;
  /** `tree.months.length`: blank scaffold months count too. */
  months: number;
  /** The roles declared on the template (`templates.roles`). */
  roles: number;
  /** Tasks with `qc_required = true`, i.e. tasks that go through review. */
  qcGates: number;
}

/** Derive the card/header counts from a template tree. */
export function templateMeta(tree: TemplateTree): TemplateMeta {
  const tasks = tplAllTasks(tree);
  return {
    tasks: tasks.length,
    months: tree.months.length,
    roles: tree.roles.length,
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
