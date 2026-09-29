// features/templates/start-project.ts — PUL-506, §13.3.2 / §14.3.8
//
// What the Start Project wizard (client) and `createProjectFromTemplate` (server) must agree on,
// in one place so the preview can never show a title the action would not write:
//   - `projectTaskTitle`: the `{{ClientName}}` / `{{ProjectName}}` / `{{MonthName}}` substitution;
//   - `toStartProjectTemplate`: the serializable slice of a template tree the wizard needs.
//
// Pure and client-safe: no DB, no clock, no I/O. The tree import is type-only.

import type { DueRule } from '../../db/schema/templates';
import { addMonthsClamped } from '../../lib/dates';
import { MONTH_NAMES } from './cascade';
import { tplAllTasks, type TemplateTree } from './hierarchy';
import { templateMeta, templateRoles, type TemplateMeta } from './template-meta';

/**
 * The calendar month name of a task's month start: `startDate` + (month − 1) months,
 * day-clamped. The same anchor `computeDueDates` uses, so Month 2 of a Sep 10 project is
 * "October".
 */
export function monthNameFor(startDate: string, monthNum: number): string {
  const monthStart = addMonthsClamped(startDate, monthNum - 1);
  return MONTH_NAMES[Number(monthStart.slice(5, 7)) - 1] ?? '';
}

/**
 * A template task title as the live task carries it. Only the three named tokens are replaced;
 * any other `{{…}}` text is left as typed rather than blanked.
 */
export function projectTaskTitle(
  title: string,
  ctx: { clientName: string; projectName: string; startDate: string; monthNum: number },
): string {
  const tokens: Record<string, string> = {
    ClientName: ctx.clientName,
    ProjectName: ctx.projectName,
    MonthName: monthNameFor(ctx.startDate, ctx.monthNum),
  };
  let out = title;
  for (const [token, value] of Object.entries(tokens)) out = out.replaceAll(`{{${token}}}`, value);
  return out;
}

/** One template task, flattened, as the wizard's preview draws it. */
export interface StartProjectTask {
  id: string;
  title: string;
  roleHint: string | null;
  category: string;
  monthNum: number;
  dueRule: DueRule;
  qcRequired: boolean;
}

/** The serializable slice of a template the wizard needs. Built on the server, sent whole. */
export interface StartProjectTemplate {
  id: string;
  name: string;
  /** Every task, in `tplAllTasks` walk order (the preview's `#N`). */
  tasks: StartProjectTask[];
  /** The distinct roles the tasks use (`templateRoles`): step 3's rows. */
  roles: string[];
  meta: TemplateMeta;
}

export function toStartProjectTemplate(tree: TemplateTree): StartProjectTemplate {
  return {
    id: tree.id,
    name: tree.name,
    tasks: tplAllTasks(tree).map((t) => ({
      id: t.id,
      title: t.title,
      roleHint: t.roleHint?.trim() || null,
      category: t._catName,
      monthNum: t._monthNum,
      dueRule: t.dueRule,
      qcRequired: t.qcRequired,
    })),
    roles: templateRoles(tree),
    meta: templateMeta(tree),
  };
}
