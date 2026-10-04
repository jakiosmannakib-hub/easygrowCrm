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

import { ONBOARDING_MONTH } from '../projects/display';
import { tplAllTasks, type TemplateTree } from './hierarchy';

export interface TemplateMeta {
  /** Every task in every category of every month. */
  tasks: number;
  /**
   * The NUMBERED months (Month 1, 2, ...): blank scaffold months count too, the Onboarding month
   * (Month 0, PUL-419) does not. Its tasks still count in `tasks`.
   */
  months: number;
  /** Whether the template has its optional Onboarding month (PUL-419). */
  onboarding: boolean;
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
    months: tree.months.filter((m) => m.num !== ONBOARDING_MONTH).length,
    onboarding: tree.months.some((m) => m.num === ONBOARDING_MONTH),
    roles: templateRoles(tree).length,
    qcGates: tasks.filter((t) => t.qcRequired).length,
  };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The months part of the stats: `2 months`, or `Onboarding + 2 months` when the template has its
 * Onboarding month (PUL-419). Shared by the footer row, the detail toolbar and the Start Project
 * preview, so all three say it the same way.
 */
export function formatMonthCount(months: number, onboarding: boolean): string {
  const numbered = count(months, 'month', 'months');
  return onboarding ? `Onboarding + ${numbered}` : numbered;
}

/** The footer row as text: `12 tasks · 2 months · 4 roles · 9 QC gates` (months per above). */
export function formatTemplateMeta(meta: TemplateMeta): string {
  return [
    count(meta.tasks, 'task', 'tasks'),
    formatMonthCount(meta.months, meta.onboarding),
    count(meta.roles, 'role', 'roles'),
    count(meta.qcGates, 'QC gate', 'QC gates'),
  ].join(' · ');
}
