// features/templates/hierarchy-walker.test.ts — PUL-502.2, §15.4 mandatory
//
// `tplAllTasks`, the canonical and only template flattener (§16.7). Pins:
//   (a) one output row per task in the tree;
//   (b) every task id exactly once — none duplicated, none dropped;
//   (c) order is month.position → category.position → task.position, whatever order the
//       arrays are stored in;
//   (d) each row carries its REAL parents' `_monthId` / `_monthNum` / `_monthName` /
//       `_catId` / `_catName`;
//   (e) a task's own `subtasks` array survives flattening;
//   (f) the input tree is not mutated (no in-place sort).
//
// Mutation proof: removing the position sort (`byPosition`) makes (c) fail, because the fixture
// stores months, categories and tasks deliberately out of order. Dropping a nesting level from
// the walk makes (a) and (b) fail.
//
// PURE test: an in-memory tree and a function with no I/O. It imports no db module, opens no
// pool, and does not call `assertTestDb`.

import { describe, expect, it } from 'vitest';
import {
  tplAllTasks,
  type TemplateCategoryNode,
  type TemplateMonthNode,
  type TemplateSubtaskNode,
  type TemplateTaskNode,
  type TemplateTree,
} from './hierarchy';

function subtask(id: string, taskId: string, position: number): TemplateSubtaskNode {
  return { id, taskId, title: `Subtask ${id}`, position };
}

function task(
  id: string,
  categoryId: string,
  position: number,
  subtasks: TemplateSubtaskNode[] = [],
): TemplateTaskNode {
  return {
    id,
    categoryId,
    position,
    title: `Task ${id}`,
    roleHint: null,
    priority: 'medium',
    estHours: null,
    dueRule: { kind: 'day', n: position },
    qcRequired: true,
    proofRequired: false,
    clientVisible: false,
    sopUrl: null,
    checklist: [],
    expectedOutput: null,
    subtasks,
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

function month(
  id: string,
  num: number,
  position: number,
  categories: TemplateCategoryNode[],
): TemplateMonthNode {
  return {
    id,
    templateId: 'tpl',
    num,
    name: `Month ${num}`,
    startMonth: 0,
    startDay: 1,
    position,
    categories,
  };
}

/**
 * Three months, 8 tasks. EVERY level is stored out of position order:
 *
 *   m1 (pos 1)  cA (pos 1): tA1 (pos 1, 2 subtasks), tA2 (pos 2)
 *               cB (pos 2): tB1
 *   m2 (pos 2)  cC (pos 1): tC1, tC2, tC3
 *   m3 (pos 3)  cD (pos 1): tD1
 *               cE (pos 2): tE1 (pos 1, 1 subtask)
 */
function buildTree(): TemplateTree {
  return {
    id: 'tpl',
    name: 'Walker fixture',
    description: null,
    category: 'SEO',
    roles: [],
    createdBy: 'seed_pm',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    months: [
      month('m3', 3, 3, [
        category('cE', 'm3', 2, [task('tE1', 'cE', 1, [subtask('sE1', 'tE1', 1)])]),
        category('cD', 'm3', 1, [task('tD1', 'cD', 1)]),
      ]),
      month('m1', 1, 1, [
        category('cB', 'm1', 2, [task('tB1', 'cB', 1)]),
        category('cA', 'm1', 1, [
          task('tA2', 'cA', 2),
          task('tA1', 'cA', 1, [subtask('sA2', 'tA1', 2), subtask('sA1', 'tA1', 1)]),
        ]),
      ]),
      month('m2', 2, 2, [
        category('cC', 'm2', 1, [task('tC3', 'cC', 3), task('tC1', 'cC', 1), task('tC2', 'cC', 2)]),
      ]),
    ],
  };
}

const TOTAL_TASKS = 8;
const EXPECTED_ORDER = ['tA1', 'tA2', 'tB1', 'tC1', 'tC2', 'tC3', 'tD1', 'tE1'];

describe('tplAllTasks', () => {
  it('(a) returns one row per task in the tree', () => {
    expect(tplAllTasks(buildTree())).toHaveLength(TOTAL_TASKS);
  });

  it('(b) visits every task id exactly once — no duplicates, none dropped', () => {
    const ids = tplAllTasks(buildTree()).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_ORDER].sort());
  });

  it('(c) orders by month.position, then category.position, then task.position', () => {
    const tree = buildTree();
    const flat = tplAllTasks(tree);
    expect(flat.map((t) => t.id)).toEqual(EXPECTED_ORDER);

    // The same claim stated as a property: the (month, category, task) position triples are
    // strictly ascending in lexicographic order.
    const monthPos = new Map(tree.months.map((m) => [m.id, m.position]));
    const catPos = new Map(tree.months.flatMap((m) => m.categories).map((c) => [c.id, c.position]));
    const keys = flat.map((t) => [monthPos.get(t._monthId)!, catPos.get(t._catId)!, t.position]);
    for (let i = 1; i < keys.length; i++) {
      const [a, b] = [keys[i - 1]!, keys[i]!];
      const cmp = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      expect(cmp).toBeLessThan(0);
    }
  });

  it('(d) attaches each task’s real month and category identity', () => {
    const tree = buildTree();
    const parents = new Map<string, { month: TemplateMonthNode; cat: TemplateCategoryNode }>();
    for (const m of tree.months) {
      for (const c of m.categories)
        for (const t of c.tasks) parents.set(t.id, { month: m, cat: c });
    }

    for (const flat of tplAllTasks(tree)) {
      const real = parents.get(flat.id)!;
      expect(flat).toMatchObject({
        _monthId: real.month.id,
        _monthNum: real.month.num,
        _monthName: real.month.name,
        _catId: real.cat.id,
        _catName: real.cat.name,
        categoryId: real.cat.id,
      });
    }
  });

  it('(e) keeps each task’s own subtasks array on the flattened row', () => {
    const flat = tplAllTasks(buildTree());
    const byId = new Map(flat.map((t) => [t.id, t]));

    expect(byId.get('tA1')!.subtasks.map((s) => s.id)).toEqual(['sA2', 'sA1']);
    expect(byId.get('tE1')!.subtasks.map((s) => s.id)).toEqual(['sE1']);
    expect(byId.get('tB1')!.subtasks).toEqual([]);
  });

  it('(f) does not mutate the input tree', () => {
    const tree = buildTree();
    const before = structuredClone(tree);
    tplAllTasks(tree);
    expect(tree).toEqual(before);
    // Explicitly: the stored (out-of-order) positions are untouched.
    expect(tree.months.map((m) => m.position)).toEqual([3, 1, 2]);
    expect(tree.months[1]!.categories[1]!.tasks.map((t) => t.position)).toEqual([2, 1]);
  });

  it('returns [] for a template with no months', () => {
    expect(tplAllTasks({ ...buildTree(), months: [] })).toEqual([]);
  });
});
