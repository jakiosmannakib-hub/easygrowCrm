// features/templates/template-meta.test.ts — PUL-503 Stage 2
//
// `templateMeta`, the four card/header numbers (§14.4.1): tasks, months, roles, QC gates.
// Pins that tasks are counted across EVERY month and category (via `tplAllTasks`), that a blank
// scaffold month still counts as a month, that roles come from `templates.roles`, and that only
// `qc_required` tasks count as QC gates. Plus the zero-month template a fresh `createTemplate`
// produces.
//
// PURE test: an in-memory tree. It imports no db module and does not call `assertTestDb`.

import { describe, expect, it } from 'vitest';
import type {
  TemplateCategoryNode,
  TemplateMonthNode,
  TemplateTaskNode,
  TemplateTree,
} from './hierarchy';
import { formatTemplateMeta, templateMeta } from './template-meta';

function task(id: string, categoryId: string, qcRequired: boolean): TemplateTaskNode {
  return {
    id,
    categoryId,
    position: 1,
    title: `Task ${id}`,
    roleHint: null,
    priority: 'medium',
    estHours: null,
    dueRule: { kind: 'day', n: 1 },
    qcRequired,
    proofRequired: false,
    clientVisible: false,
    sopUrl: null,
    checklist: [],
    expectedOutput: null,
    subtasks: [],
  };
}

function category(id: string, monthId: string, tasks: TemplateTaskNode[]): TemplateCategoryNode {
  return { id, monthId, name: `Category ${id}`, position: 1, tasks };
}

function month(id: string, num: number, categories: TemplateCategoryNode[]): TemplateMonthNode {
  return {
    id,
    templateId: 'tpl',
    num,
    name: `Month ${num}`,
    startMonth: 0,
    startDay: 1,
    position: num,
    categories,
  };
}

function tree(months: TemplateMonthNode[], roles: string[]): TemplateTree {
  return {
    id: 'tpl',
    name: 'Meta fixture',
    description: null,
    category: 'SEO',
    roles,
    createdBy: 'seed_pm',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    months,
  };
}

/**
 * 3 months (the third a blank scaffold), 3 categories, 6 tasks of which 4 are QC-gated, and 4
 * declared roles.
 *
 *   m1  cA: t1 (QC), t2 (QC), t3 (no QC)
 *       cB: t4 (QC)
 *   m2  cC: t5 (no QC), t6 (QC)
 *   m3  (no categories)
 */
const FULL = tree(
  [
    month('m1', 1, [
      category('cA', 'm1', [task('t1', 'cA', true), task('t2', 'cA', true), task('t3', 'cA', false)]),
      category('cB', 'm1', [task('t4', 'cB', true)]),
    ]),
    month('m2', 2, [category('cC', 'm2', [task('t5', 'cC', false), task('t6', 'cC', true)])]),
    month('m3', 3, []),
  ],
  ['Project Manager', 'SEO Executive', 'Content Writer', 'QC'],
);

describe('templateMeta', () => {
  it('counts tasks across every month and category, months, roles, and QC gates', () => {
    expect(templateMeta(FULL)).toEqual({ tasks: 6, months: 3, roles: 4, qcGates: 4 });
  });

  it('returns zeros for a fresh template with no months', () => {
    expect(templateMeta(tree([], []))).toEqual({ tasks: 0, months: 0, roles: 0, qcGates: 0 });
  });

  it('counts roles from the template even when it has no months yet', () => {
    expect(templateMeta(tree([], ['QC', 'Developer']))).toEqual({
      tasks: 0,
      months: 0,
      roles: 2,
      qcGates: 0,
    });
  });
});

describe('formatTemplateMeta', () => {
  it('renders the §14.4.1 footer row', () => {
    expect(formatTemplateMeta(templateMeta(FULL))).toBe('6 tasks · 3 months · 4 roles · 4 QC gates');
  });

  it('uses the singular for a count of one', () => {
    expect(formatTemplateMeta({ tasks: 1, months: 1, roles: 1, qcGates: 1 })).toBe(
      '1 task · 1 month · 1 role · 1 QC gate',
    );
  });
});
