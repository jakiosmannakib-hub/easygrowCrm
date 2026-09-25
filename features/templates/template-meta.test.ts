// features/templates/template-meta.test.ts — PUL-503 Stage 2, amended in Stage 3a
//
// `templateMeta`, the four card/header numbers (§14.4.1): tasks, months, roles, QC gates, and
// `templateRoles`, the role pills. Pins that:
//   - tasks are counted across EVERY month and category (via `tplAllTasks`);
//   - a blank scaffold month still counts as a month;
//   - roles are the distinct `role_hint` values the TASKS use, not `templates.roles`: a task's
//     role missing from the palette still counts, and a palette role no task uses does not;
//   - only `qc_required` tasks count as QC gates;
//   - a fresh `createTemplate` (no months) is all zeros.
//
// PURE test: an in-memory tree. It imports no db module and does not call `assertTestDb`.

import { describe, expect, it } from 'vitest';
import type {
  TemplateCategoryNode,
  TemplateMonthNode,
  TemplateTaskNode,
  TemplateTree,
} from './hierarchy';
import { formatTemplateMeta, templateMeta, templateRoles } from './template-meta';

function task(
  id: string,
  categoryId: string,
  position: number,
  qcRequired: boolean,
  roleHint: string | null,
): TemplateTaskNode {
  return {
    id,
    categoryId,
    position,
    title: `Task ${id}`,
    roleHint,
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

function category(
  id: string,
  monthId: string,
  position: number,
  tasks: TemplateTaskNode[],
): TemplateCategoryNode {
  return { id, monthId, name: `Category ${id}`, position, tasks };
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
 * 3 months (the third a blank scaffold), 3 categories, 6 tasks of which 4 are QC-gated.
 *
 * The tasks use 3 distinct roles: SEO Executive, Content Writer, and "Link Builder", which is
 * NOT in the declared palette. The palette declares "Developer", which no task uses.
 *
 *   m1  cA: t1 (QC, SEO Executive), t2 (QC, Content Writer), t3 (no QC, SEO Executive)
 *       cB: t4 (QC, no role)
 *   m2  cC: t5 (no QC, Link Builder), t6 (QC, blank role "  ")
 *   m3  (no categories)
 */
const PALETTE = ['SEO Executive', 'Content Writer', 'Developer'];

const FULL = tree(
  [
    month('m1', 1, [
      category('cA', 'm1', 1, [
        task('t1', 'cA', 1, true, 'SEO Executive'),
        task('t2', 'cA', 2, true, 'Content Writer'),
        task('t3', 'cA', 3, false, 'SEO Executive'),
      ]),
      category('cB', 'm1', 2, [task('t4', 'cB', 1, true, null)]),
    ]),
    month('m2', 2, [
      category('cC', 'm2', 1, [
        task('t5', 'cC', 1, false, 'Link Builder'),
        task('t6', 'cC', 2, true, '  '),
      ]),
    ]),
    month('m3', 3, []),
  ],
  PALETTE,
);

describe('templateMeta', () => {
  it('counts tasks across every month and category, months, task roles, and QC gates', () => {
    expect(templateMeta(FULL)).toEqual({ tasks: 6, months: 3, roles: 3, qcGates: 4 });
  });

  it('returns zeros for a fresh template with no months', () => {
    expect(templateMeta(tree([], []))).toEqual({ tasks: 0, months: 0, roles: 0, qcGates: 0 });
  });

  it('counts no roles for a template with a palette but no tasks', () => {
    expect(templateMeta(tree([], ['QC', 'Developer'])).roles).toBe(0);
  });
});

describe('templateRoles', () => {
  it('lists the distinct task roles in walk order, skipping null and blank', () => {
    expect(templateRoles(FULL)).toEqual(['SEO Executive', 'Content Writer', 'Link Builder']);
  });

  it('includes a task role that is not in templates.roles', () => {
    expect(PALETTE).not.toContain('Link Builder');
    expect(templateRoles(FULL)).toContain('Link Builder');
  });

  it('omits a declared role that no task uses', () => {
    expect(PALETTE).toContain('Developer');
    expect(templateRoles(FULL)).not.toContain('Developer');
  });
});

describe('formatTemplateMeta', () => {
  it('renders the §14.4.1 footer row', () => {
    expect(formatTemplateMeta(templateMeta(FULL))).toBe('6 tasks · 3 months · 3 roles · 4 QC gates');
  });

  it('uses the singular for a count of one', () => {
    expect(formatTemplateMeta({ tasks: 1, months: 1, roles: 1, qcGates: 1 })).toBe(
      '1 task · 1 month · 1 role · 1 QC gate',
    );
  });
});
