// features/projects/list.test.ts — PUL-410 Stage 2
//
// Not a §15.4 mandatory file. The unit-lane guard on the List view's pure helpers in display.ts:
// `groupTaskTree` (where each row lands in Month → Category → Task), `treeOpenState` (the §16.10
// collapse map — complete, never lazily keyed) and `categoryDotClass` (a stable color per name).
// No render, no DB.

import { describe, expect, it } from 'vitest';
import {
  categoryDotClass,
  groupTaskTree,
  taskKey,
  treeOpenState,
  type TaskStatus,
} from './display';

function row(
  id: string,
  month: number | null,
  category: string,
  status: TaskStatus = 'planned',
  subtaskTotal = 0,
) {
  return { id, month, category, status, subtaskTotal };
}

describe('groupTaskTree', () => {
  it('returns [] for no rows', () => {
    expect(groupTaskTree([])).toEqual([]);
  });

  it('sorts months ascending with Unscheduled (null) LAST, whatever the input order', () => {
    const tree = groupTaskTree([
      row('a', null, 'SEO'),
      row('b', 3, 'SEO'),
      row('c', 1, 'SEO'),
      row('d', 10, 'SEO'),
    ]);
    expect(tree.map((m) => m.month)).toEqual([1, 3, 10, null]);
  });

  it('sorts categories alphabetically within a month, independent of input order', () => {
    const tree = groupTaskTree([
      row('a', 1, 'Technical'),
      row('b', 1, 'Content'),
      row('c', 1, 'Links'),
    ]);
    expect(tree[0]!.categories.map((c) => c.category)).toEqual(['Content', 'Links', 'Technical']);
  });

  it('keeps the input (query) order of tasks within a category', () => {
    const tree = groupTaskTree([row('z', 1, 'SEO'), row('a', 1, 'SEO'), row('m', 1, 'SEO')]);
    expect(tree[0]!.categories[0]!.tasks.map((t) => t.id)).toEqual(['z', 'a', 'm']);
  });

  it('places every row exactly once', () => {
    const rows = [
      row('a', 1, 'SEO'),
      row('b', 1, 'Content'),
      row('c', 2, 'SEO'),
      row('d', null, 'Ad hoc'),
      row('e', null, 'SEO'),
    ];
    const placed = groupTaskTree(rows).flatMap((m) =>
      m.categories.flatMap((c) => c.tasks.map((t) => t.id)),
    );
    expect(placed.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('counts done (approved / completed) and total per category and per month', () => {
    const tree = groupTaskTree([
      row('a', 1, 'SEO', 'approved'),
      row('b', 1, 'SEO', 'in_progress'),
      row('c', 1, 'Content', 'completed'),
      row('d', 1, 'Content', 'submitted'),
      row('e', 1, 'Content', 'planned'),
    ]);
    const [month] = tree;
    expect(month).toMatchObject({ done: 2, total: 5 });
    expect(month!.categories.map((c) => [c.category, c.done, c.total])).toEqual([
      ['Content', 1, 3],
      ['SEO', 1, 2],
    ]);
  });

  it('does not count `submitted` as done — it is awaiting review, not finished', () => {
    const [month] = groupTaskTree([row('a', 1, 'SEO', 'submitted')]);
    expect(month).toMatchObject({ done: 0, total: 1 });
  });

  it('gives every group a key unique across the tree — the same category in two months differs', () => {
    const tree = groupTaskTree([row('a', 1, 'SEO'), row('b', 2, 'SEO'), row('c', null, 'SEO')]);
    const keys = tree.flatMap((m) => [m.key, ...m.categories.map((c) => c.key)]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('month:none');
  });

  it('keeps keys stable across calls, so collapse state survives a refetch', () => {
    const rows = [row('a', 2, 'SEO'), row('b', null, 'Content')];
    const keysOf = (t: ReturnType<typeof groupTaskTree>) =>
      t.flatMap((m) => [m.key, ...m.categories.map((c) => c.key)]);
    expect(keysOf(groupTaskTree(rows))).toEqual(keysOf(groupTaskTree([...rows].reverse())));
  });
});

describe('treeOpenState', () => {
  const tree = groupTaskTree([
    row('a', 1, 'SEO'),
    row('b', 2, 'SEO', 'planned', 3),
    row('c', 2, 'Content'),
    row('d', 3, 'SEO', 'approved', 1),
    row('e', null, 'Ad hoc'),
  ]);
  const allKeys = [
    ...tree.flatMap((m) => [m.key, ...m.categories.map((c) => c.key)]),
    taskKey('b'),
    taskKey('d'),
  ];

  it('is COMPLETE — every month, category and expandable-task key has an entry (§16.10)', () => {
    const state = treeOpenState(tree, {});
    expect(Object.keys(state).sort()).toEqual([...allKeys].sort());
    expect(Object.values(state).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('expands every month by default, Unscheduled included', () => {
    const state = treeOpenState(tree, {});
    expect(tree.map((m) => [m.month, state[m.key]])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [null, true],
    ]);
  });

  it('expands every category by default', () => {
    const state = treeOpenState(tree, {});
    const categoryKeys = tree.flatMap((m) => m.categories.map((c) => c.key));
    expect(categoryKeys.every((k) => state[k])).toBe(true);
  });

  it('collapses tasks with subtasks by default, and gives subtask-less tasks no key', () => {
    const state = treeOpenState(tree, {});
    expect(state[taskKey('b')]).toBe(false);
    expect(state[taskKey('d')]).toBe(false);
    expect(state).not.toHaveProperty(taskKey('a'));
  });

  it('lets a user override beat the default, in both directions', () => {
    const state = treeOpenState(tree, { 'month:1': false, [taskKey('b')]: true });
    expect(state['month:1']).toBe(false);
    expect(state[taskKey('b')]).toBe(true);
  });

  it('ignores overrides for keys no longer in the tree rather than adding them', () => {
    const state = treeOpenState(tree, { 'month:99': true, [taskKey('a')]: true });
    expect(state).not.toHaveProperty('month:99');
    expect(state).not.toHaveProperty(taskKey('a'));
  });
});

describe('categoryDotClass', () => {
  it('is stable — the same name always gets the same dot', () => {
    expect(categoryDotClass('On-page SEO')).toBe(categoryDotClass('On-page SEO'));
  });

  it('always returns a full static bg-* class Tailwind can see', () => {
    for (const name of ['SEO', 'Content', 'Links', 'Technical', '', 'গবেষণা']) {
      expect(categoryDotClass(name)).toMatch(/^bg-[a-z]+-500$/);
    }
  });

  it('spreads common categories across more than one color', () => {
    const colors = new Set(
      ['SEO', 'Content', 'Links', 'Technical', 'Reporting', 'Local', 'GEO'].map(categoryDotClass),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
