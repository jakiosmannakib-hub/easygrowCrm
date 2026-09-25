// features/templates/template-actions.test.ts — PUL-503 Stage 1
//
// Contract test for the §13.3.6–13.3.7 template hierarchy actions and `loadTemplateTree`.
//
// Same rig as the clients and employees tests: the real easygrowcrm_test database, no DB mocks
// and no mocked `authorize()` (§15.8). The only stub is `auth.api.getSession`, the HTTP session
// envelope; `getSessionUser()` still re-reads `role` and `active` from Postgres (§16.5), so every
// authz case is decided by a real row. Time is frozen through the clock port.
//
// Mutation proofs (run by hand at PUL-503, recorded in §17):
//   - Stage 1, when the task gate was inline: flipping its predicate (`->>'ref' = id` → `<>`)
//     failed "blocks deleting a task another task is scheduled after" and "deletes a task
//     nothing depends on".
//   - Stage 1 amendment, the shared `assertNoOutsideDependents`: inverting the subtree
//     membership filter (`!inside.has(d.id)` → `inside.has(d.id)`) fails the task gate, (a) and
//     (b), which now let an OUTSIDE dependent through, and (c), which is now blocked by an
//     INSIDE one.
//   - Dropping the delete-missing step of the subtask reconcile fails "reconciles subtasks to
//     the submitted list": the removed subtask survives, so the stored list does not match.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  auditLog,
  templateCategories,
  templateMonths,
  templates,
  templateTasks,
  templateTaskSubtasks,
  user as userTable,
} from '../../db/schema';
import type { DueRule } from '../../db/schema/templates';
import { createTestClock, resetClock, setClock, type TestClock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { assertTestDb, seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const {
  addTemplateCategory,
  addTemplateMonth,
  addTemplateTask,
  createTemplate,
  deleteTemplate,
  deleteTemplateCategory,
  deleteTemplateMonth,
  deleteTemplateTask,
  renameTemplateCategory,
  renameTemplateMonth,
  updateTemplateTask,
} = await import('./actions');
const { loadTemplateTree, templatesListQuery } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');
const LATER = new Date('2026-09-15T05:00:00.000Z');

let seed: MinimalSeed;
let testClock: TestClock;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function auditFor(templateId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, templateId));
}

async function templateRow(templateId: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);
  return row;
}

async function subtaskRows(taskId: string) {
  return db
    .select()
    .from(templateTaskSubtasks)
    .where(eq(templateTaskSubtasks.taskId, taskId))
    .orderBy(templateTaskSubtasks.position);
}

/** A template with one month and one category, built through the actions, as the PM. */
async function scaffold(name = 'Scaffold') {
  actAs(seed.projectManager.id);
  const template = expectOk(await createTemplate({ name, roles: ['SEO Specialist'] }));
  const month = expectOk(await addTemplateMonth({ templateId: template.id }));
  const category = expectOk(await addTemplateCategory({ monthId: month.id, name: 'On-page' }));
  return { template, month, category };
}

/** A task with the given subtask titles, due Day 1 unless a rule is passed. */
async function addTask(
  categoryId: string,
  title: string,
  subtasks: string[] = [],
  dueRule: DueRule = { kind: 'day', n: 1 },
) {
  return expectOk(
    await addTemplateTask({ categoryId, title, dueRule, subtasks: subtasks.map((t) => ({ title: t })) }),
  );
}

beforeEach(async () => {
  seed = await seedMinimal();
  testClock = createTestClock(NOW);
  setClock(testClock);
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('createTemplate (§13.3.6a)', () => {
  it('creates an empty template (no months) and audits template.created', async () => {
    actAs(seed.projectManager.id);

    const row = expectOk(
      await createTemplate({ name: 'Local SEO', category: 'SEO', roles: ['SEO Specialist'] }),
    );

    expect(row.id).toMatch(/^tpl_/);
    expect(row).toMatchObject({
      name: 'Local SEO',
      category: 'SEO',
      roles: ['SEO Specialist'],
      createdBy: seed.projectManager.id,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    const tree = await loadTemplateTree(db, row.id);
    expect(tree?.months).toEqual([]);

    const audit = await auditFor(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'template.created',
      resourceType: 'template',
      before: null,
    });
  });
});

describe('months (addTemplateMonth, §13.3.7b)', () => {
  it('adds blank months at num/position max + 1 with the defaults', async () => {
    const { template, month } = await scaffold();

    expect(month).toMatchObject({ num: 1, position: 1, name: 'Month 1', startMonth: 0, startDay: 1 });

    const second = expectOk(
      await addTemplateMonth({ templateId: template.id, startMonth: 2, startDay: 10 }),
    );
    expect(second).toMatchObject({ num: 2, position: 2, name: 'Month 2', startMonth: 2, startDay: 10 });

    const audit = await auditFor(template.id);
    expect(audit.filter((a) => a.action === 'template.month_added')).toHaveLength(2);
  });

  it('renames a month, and a same-name rename writes nothing', async () => {
    const { template, month } = await scaffold();
    testClock.set(LATER);

    const renamed = expectOk(await renameTemplateMonth({ monthId: month.id, name: 'Kickoff' }));
    expect(renamed.name).toBe('Kickoff');
    expect((await templateRow(template.id))!.updatedAt).toEqual(LATER);

    const renames = async () =>
      (await auditFor(template.id)).filter((a) => a.action === 'template.month_renamed');
    expect(await renames()).toHaveLength(1);
    expect((await renames())[0]).toMatchObject({
      before: { monthId: month.id, name: 'Month 1' },
      after: { monthId: month.id, name: 'Kickoff' },
    });

    expectOk(await renameTemplateMonth({ monthId: month.id, name: 'Kickoff' }));
    expect(await renames()).toHaveLength(1);
  });

  it('deletes a month and cascades its categories, tasks and subtasks', async () => {
    const { template, month, category } = await scaffold();
    const task = await addTask(category.id, 'Audit GBP', ['Photos', 'Hours']);

    expectOk(await deleteTemplateMonth({ monthId: month.id }));

    expect(await db.select().from(templateMonths).where(eq(templateMonths.id, month.id))).toEqual([]);
    expect(
      await db.select().from(templateCategories).where(eq(templateCategories.id, category.id)),
    ).toEqual([]);
    expect(await db.select().from(templateTasks).where(eq(templateTasks.id, task.id))).toEqual([]);
    expect(await subtaskRows(task.id)).toEqual([]);

    const audit = await auditFor(template.id);
    expect(audit.find((a) => a.action === 'template.month_deleted')).toMatchObject({
      before: { id: month.id },
      after: null,
    });
  });

  it('returns NOT_FOUND for a missing month', async () => {
    actAs(seed.projectManager.id);
    expectFail(await renameTemplateMonth({ monthId: 'tm_missing', name: 'x' }), 'NOT_FOUND');
  });
});

describe('categories (§13.3.7c)', () => {
  it('adds, renames and deletes a category; the delete cascades its tasks', async () => {
    const { template, month, category } = await scaffold();
    expect(category.position).toBe(1);

    const second = expectOk(await addTemplateCategory({ monthId: month.id, name: 'Reporting' }));
    expect(second.position).toBe(2);

    const renamed = expectOk(
      await renameTemplateCategory({ categoryId: second.id, name: 'Monthly reporting' }),
    );
    expect(renamed.name).toBe('Monthly reporting');

    const task = await addTask(second.id, 'Send report', ['Draft']);
    expectOk(await deleteTemplateCategory({ categoryId: second.id }));

    expect(await db.select().from(templateTasks).where(eq(templateTasks.id, task.id))).toEqual([]);
    expect(await subtaskRows(task.id)).toEqual([]);

    const actions = (await auditFor(template.id)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'template.category_added',
        'template.category_renamed',
        'template.category_deleted',
      ]),
    );
  });
});

describe('addTemplateTask (§13.3.7d)', () => {
  it('writes the task and its subtasks in one call, with one audit row', async () => {
    const { template, category } = await scaffold();
    const before = (await auditFor(template.id)).length;

    const task = expectOk(
      await addTemplateTask({
        categoryId: category.id,
        title: 'Optimise {{ClientName}} homepage',
        roleHint: 'SEO Specialist',
        priority: 'high',
        estHours: 1.5,
        dueRule: { kind: 'before_deadline', n: 3 },
        checklist: ['Title tag', 'Meta description'],
        clientVisible: true,
        sopUrl: 'https://sop.example/homepage',
        expectedOutput: 'Updated homepage copy',
        subtasks: [{ title: 'Keyword map' }, { title: 'Rewrite H1' }],
      }),
    );

    expect(task).toMatchObject({
      title: 'Optimise {{ClientName}} homepage', // tokens stored verbatim
      position: 1,
      priority: 'high',
      estHours: '1.50',
      dueRule: { kind: 'before_deadline', n: 3 },
      checklist: ['Title tag', 'Meta description'],
      clientVisible: true,
      sopUrl: 'https://sop.example/homepage',
      expectedOutput: 'Updated homepage copy',
    });
    expect((await subtaskRows(task.id)).map((s) => [s.title, s.position])).toEqual([
      ['Keyword map', 1],
      ['Rewrite H1', 2],
    ]);

    const audit = await auditFor(template.id);
    expect(audit).toHaveLength(before + 1);
    expect(audit.at(-1)).toMatchObject({ action: 'template.task_added', before: null });
  });

  it('rejects an after-rule that points outside the template (GATE:bad_ref)', async () => {
    const a = await scaffold('A');
    const b = await scaffold('B');
    const foreign = await addTask(b.category.id, 'Foreign task');

    const result = await addTemplateTask({
      categoryId: a.category.id,
      title: 'Depends on B',
      dueRule: { kind: 'after', ref: foreign.id },
    });

    expectFail(result, 'GATE', 'bad_ref');
    expect(
      await db.select().from(templateTasks).where(eq(templateTasks.categoryId, a.category.id)),
    ).toEqual([]);
  });
});

describe('updateTemplateTask (§13.3.7d)', () => {
  it('reconciles subtasks to the submitted list and audits only what changed', async () => {
    const { template, category } = await scaffold();
    const task = await addTask(category.id, 'Build citations', ['Alpha', 'Bravo', 'Charlie']);
    const [alpha, bravo, charlie] = await subtaskRows(task.id);
    const auditBefore = (await auditFor(template.id)).length;

    const updated = expectOk(
      await updateTemplateTask({
        templateTaskId: task.id,
        title: 'Build local citations',
        priority: 'medium', // sent, but unchanged: must not appear in the diff
        subtasks: [
          { id: alpha!.id, title: 'Alpha (renamed)' },
          { id: charlie!.id, title: 'Charlie' },
          { title: 'Delta' },
        ],
      }),
    );

    const stored = await subtaskRows(task.id);
    expect(stored.map((s) => [s.title, s.position])).toEqual([
      ['Alpha (renamed)', 1],
      ['Charlie', 2],
      ['Delta', 3],
    ]);
    expect(stored.map((s) => s.id)).not.toContain(bravo!.id);
    expect(stored[0]!.id).toBe(alpha!.id); // renamed in place, not re-created
    expect(updated.subtasks.map((s) => s.title)).toEqual(['Alpha (renamed)', 'Charlie', 'Delta']);

    const audit = await auditFor(template.id);
    expect(audit).toHaveLength(auditBefore + 1);
    const row = audit.at(-1)!;
    expect(row.action).toBe('template.task_updated');
    expect(Object.keys(row.before as object).sort()).toEqual(['subtasks', 'taskId', 'title']);
    expect(row.before).toEqual({
      taskId: task.id,
      title: 'Build citations',
      subtasks: [
        { id: alpha!.id, title: 'Alpha' },
        { id: bravo!.id, title: 'Bravo' },
        { id: charlie!.id, title: 'Charlie' },
      ],
    });
    expect(row.after).toEqual({
      taskId: task.id,
      title: 'Build local citations',
      subtasks: [
        { id: alpha!.id, title: 'Alpha (renamed)' },
        { id: charlie!.id, title: 'Charlie' },
        { id: stored[2]!.id, title: 'Delta' },
      ],
    });
  });

  it('writes nothing for a save that changes nothing', async () => {
    const { template, category } = await scaffold();
    const task = await addTask(category.id, 'Same', ['One']);
    const [one] = await subtaskRows(task.id);
    const auditBefore = (await auditFor(template.id)).length;
    testClock.set(LATER);

    const result = expectOk(
      await updateTemplateTask({
        templateTaskId: task.id,
        title: 'Same',
        dueRule: { kind: 'day', n: 1 },
        estHours: null,
        checklist: [],
        subtasks: [{ id: one!.id, title: 'One' }],
      }),
    );

    expect(result.title).toBe('Same');
    expect(await auditFor(template.id)).toHaveLength(auditBefore);
    expect((await templateRow(template.id))!.updatedAt).toEqual(NOW);
  });

  it('rejects a self-reference and a cycle (GATE:bad_ref)', async () => {
    const { category } = await scaffold();
    const first = await addTask(category.id, 'First');
    const second = await addTask(category.id, 'Second', [], { kind: 'after', ref: first.id });

    expectFail(
      await updateTemplateTask({ templateTaskId: first.id, dueRule: { kind: 'after', ref: first.id } }),
      'GATE',
      'bad_ref',
    );
    expectFail(
      await updateTemplateTask({
        templateTaskId: first.id,
        dueRule: { kind: 'after', ref: second.id },
      }),
      'GATE',
      'bad_ref',
    );
  });

  it('refuses a subtask id that belongs to another task', async () => {
    const { category } = await scaffold();
    const a = await addTask(category.id, 'A', ['A1']);
    const b = await addTask(category.id, 'B', ['B1']);
    const [b1] = await subtaskRows(b.id);

    expectFail(
      await updateTemplateTask({ templateTaskId: a.id, subtasks: [{ id: b1!.id, title: 'B1' }] }),
      'VALIDATION',
    );
    expect(await subtaskRows(b.id)).toHaveLength(1);
  });
});

describe('deleteTemplateTask (§13.3.7d)', () => {
  it('blocks deleting a task another task is scheduled after (GATE:task_has_dependents)', async () => {
    const { category } = await scaffold();
    const anchor = await addTask(category.id, 'Anchor', ['Keep me']);
    const dependent = await addTask(category.id, 'Follow-up', [], { kind: 'after', ref: anchor.id });

    const failure = expectFail(
      await deleteTemplateTask({ templateTaskId: anchor.id }),
      'GATE',
      'task_has_dependents',
    );
    expect(failure.details).toMatchObject({ taskIds: [dependent.id] });

    expect(await db.select().from(templateTasks).where(eq(templateTasks.id, anchor.id))).toHaveLength(
      1,
    );
    expect(await subtaskRows(anchor.id)).toHaveLength(1);
  });

  it('deletes a task nothing depends on, cascading its subtasks', async () => {
    const { template, category } = await scaffold();
    const anchor = await addTask(category.id, 'Anchor');
    const dependent = await addTask(category.id, 'Follow-up', [], { kind: 'after', ref: anchor.id });
    const lonely = await addTask(category.id, 'Lonely', ['Sub']);

    expectOk(await deleteTemplateTask({ templateTaskId: lonely.id }));
    expect(await subtaskRows(lonely.id)).toEqual([]);

    // Once the dependent goes, the anchor can go too.
    expectOk(await deleteTemplateTask({ templateTaskId: dependent.id }));
    expectOk(await deleteTemplateTask({ templateTaskId: anchor.id }));
    expect(
      await db.select().from(templateTasks).where(eq(templateTasks.categoryId, category.id)),
    ).toEqual([]);

    const deletions = (await auditFor(template.id)).filter(
      (a) => a.action === 'template.task_deleted',
    );
    expect(deletions).toHaveLength(3);
  });
});

describe('subtree deletes and the dependents gate (month / category)', () => {
  /**
   * Month 1 → categories `first` and `second`; Month 2 → category `later`. One task in each,
   * all due Day 1; each test then points `after` rules where it needs them.
   */
  async function twoMonths() {
    const { template, month, category: first } = await scaffold();
    const second = expectOk(await addTemplateCategory({ monthId: month.id, name: 'Second' }));
    const month2 = expectOk(await addTemplateMonth({ templateId: template.id }));
    const later = expectOk(await addTemplateCategory({ monthId: month2.id, name: 'Later' }));
    return { template, month, month2, first, second, later };
  }

  async function stillThere(taskId: string) {
    return (await db.select().from(templateTasks).where(eq(templateTasks.id, taskId))).length === 1;
  }

  it('(a) blocks deleting a month when a task in another month is scheduled after it', async () => {
    const { month, first, later } = await twoMonths();
    const anchor = await addTask(first.id, 'Anchor', ['Sub']);
    const outside = await addTask(later.id, 'Month-2 follow-up', [], { kind: 'after', ref: anchor.id });

    const failure = expectFail(
      await deleteTemplateMonth({ monthId: month.id }),
      'GATE',
      'task_has_dependents',
    );
    expect(failure.details).toMatchObject({ taskIds: [outside.id], titles: ['Month-2 follow-up'] });
    expect(failure.message).toContain('Month-2 follow-up');

    // Nothing cascaded.
    expect(await db.select().from(templateMonths).where(eq(templateMonths.id, month.id))).toHaveLength(
      1,
    );
    expect(await stillThere(anchor.id)).toBe(true);
    expect(await subtaskRows(anchor.id)).toHaveLength(1);
  });

  it('(b) blocks deleting a category when a task outside it is scheduled after it', async () => {
    const { first, second } = await twoMonths();
    const anchor = await addTask(first.id, 'Anchor');
    const outside = await addTask(second.id, 'Sibling follow-up', [], { kind: 'after', ref: anchor.id });

    const failure = expectFail(
      await deleteTemplateCategory({ categoryId: first.id }),
      'GATE',
      'task_has_dependents',
    );
    expect(failure.details).toMatchObject({ taskIds: [outside.id] });
    expect(failure.message).toContain('Sibling follow-up');
    expect(await stillThere(anchor.id)).toBe(true);
  });

  it('(c) allows both deletes when the only dependents are inside the deleted subtree', async () => {
    const { month, first, second, later } = await twoMonths();

    // Category: the dependent sits in the same category.
    const catAnchor = await addTask(later.id, 'Later anchor');
    const catDependent = await addTask(later.id, 'Later follow-up', [], {
      kind: 'after',
      ref: catAnchor.id,
    });
    expectOk(await deleteTemplateCategory({ categoryId: later.id }));
    expect(await stillThere(catAnchor.id)).toBe(false);
    expect(await stillThere(catDependent.id)).toBe(false);

    // Month: the dependent sits in a different category of the same month.
    const monthAnchor = await addTask(first.id, 'Month anchor');
    const monthDependent = await addTask(second.id, 'Month follow-up', [], {
      kind: 'after',
      ref: monthAnchor.id,
    });
    expectOk(await deleteTemplateMonth({ monthId: month.id }));
    expect(await stillThere(monthAnchor.id)).toBe(false);
    expect(await stillThere(monthDependent.id)).toBe(false);
  });

  it('(d) allows both deletes when nothing depends on the subtree', async () => {
    const { month, month2, first, second, later } = await twoMonths();
    await addTask(first.id, 'Plain');
    await addTask(second.id, 'Plain too');
    // An `after` chain that lives entirely outside the subtrees being deleted must not block.
    const laterAnchor = await addTask(later.id, 'Later anchor');
    await addTask(later.id, 'Later follow-up', [], { kind: 'after', ref: laterAnchor.id });

    expectOk(await deleteTemplateCategory({ categoryId: second.id }));
    expectOk(await deleteTemplateMonth({ monthId: month.id }));
    expect(await db.select().from(templateMonths).where(eq(templateMonths.id, month2.id))).toHaveLength(
      1,
    );
  });
});

describe('deleteTemplate (§13.3.6c)', () => {
  it('soft-deletes: the row stays, loadTemplateTree returns null, re-delete is a no-op', async () => {
    const { template, month } = await scaffold();

    expectOk(await deleteTemplate({ templateId: template.id }));

    expect((await templateRow(template.id))!.deletedAt).toEqual(NOW);
    expect(await loadTemplateTree(db, template.id)).toBeNull();
    // The hierarchy is untouched by a soft delete.
    expect(await db.select().from(templateMonths).where(eq(templateMonths.id, month.id))).toHaveLength(
      1,
    );

    const deletions = async () =>
      (await auditFor(template.id)).filter((a) => a.action === 'template.deleted');
    expect(await deletions()).toHaveLength(1);

    expectOk(await deleteTemplate({ templateId: template.id }));
    expect(await deletions()).toHaveLength(1);

    // A deleted template's hierarchy can no longer be edited.
    expectFail(await addTemplateMonth({ templateId: template.id }), 'NOT_FOUND');
    expectFail(await renameTemplateMonth({ monthId: month.id, name: 'x' }), 'NOT_FOUND');
  });

  it('drops out of templatesListQuery', async () => {
    const kept = await scaffold('Kept');
    const gone = await scaffold('Gone');
    expectOk(await deleteTemplate({ templateId: gone.template.id }));

    const ids = (await templatesListQuery()).map((t) => t.id);
    expect(ids).toContain(kept.template.id);
    expect(ids).not.toContain(gone.template.id);
  });
});

describe('authorization (§9.6 ⁹)', () => {
  it('denies an employee every template write, and writes nothing', async () => {
    const { template, month, category } = await scaffold();
    const task = await addTask(category.id, 'Guarded');
    const auditBefore = (await auditFor(template.id)).length;

    actAs(seed.employees[0].id);
    expectFail(await createTemplate({ name: 'Nope' }), 'FORBIDDEN');
    expectFail(await addTemplateMonth({ templateId: template.id }), 'FORBIDDEN');
    expectFail(await addTemplateCategory({ monthId: month.id, name: 'Nope' }), 'FORBIDDEN');
    expectFail(await updateTemplateTask({ templateTaskId: task.id, title: 'Nope' }), 'FORBIDDEN');
    expectFail(await deleteTemplateTask({ templateTaskId: task.id }), 'FORBIDDEN');
    expectFail(await deleteTemplate({ templateId: template.id }), 'FORBIDDEN');

    expect(await auditFor(template.id)).toHaveLength(auditBefore);
    expect((await templateRow(template.id))!.deletedAt).toBeNull();
  });

  it('denies HR (read-only) and allows a team leader', async () => {
    assertTestDb();
    await db.update(userTable).set({ role: 'admin_hr' }).where(eq(userTable.id, seed.employees[2].id));

    actAs(seed.employees[2].id);
    expectFail(await createTemplate({ name: 'HR template' }), 'FORBIDDEN');

    actAs(seed.teamLeader.id);
    expectOk(await createTemplate({ name: 'TL template' }));
  });
});

describe('loadTemplateTree', () => {
  it('nests months → categories → tasks → subtasks, each level in position order', async () => {
    // Inserted deliberately out of position order at every level, straight into the tables.
    assertTestDb();
    await db.insert(templates).values({ id: 'tpl_order', name: 'Order', createdBy: seed.projectManager.id });
    await db.insert(templateMonths).values([
      { id: 'm2', templateId: 'tpl_order', num: 2, name: 'Month 2', startMonth: 0, startDay: 1, position: 2 },
      { id: 'm1', templateId: 'tpl_order', num: 1, name: 'Month 1', startMonth: 0, startDay: 1, position: 1 },
    ]);
    await db.insert(templateCategories).values([
      { id: 'c1b', monthId: 'm1', name: 'B', position: 2 },
      { id: 'c1a', monthId: 'm1', name: 'A', position: 1 },
      { id: 'c2a', monthId: 'm2', name: 'C', position: 1 },
    ]);
    const rule = { kind: 'day' as const, n: 1 };
    await db.insert(templateTasks).values([
      { id: 't2', categoryId: 'c1a', position: 2, title: 'T2', dueRule: rule },
      { id: 't1', categoryId: 'c1a', position: 1, title: 'T1', dueRule: rule },
      { id: 't3', categoryId: 'c1b', position: 1, title: 'T3', dueRule: rule },
      { id: 't4', categoryId: 'c2a', position: 1, title: 'T4', dueRule: rule },
    ]);
    await db.insert(templateTaskSubtasks).values([
      { id: 's2', taskId: 't1', title: 'S2', position: 2 },
      { id: 's1', taskId: 't1', title: 'S1', position: 1 },
    ]);

    const tree = (await loadTemplateTree(db, 'tpl_order'))!;

    expect(tree.months.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(tree.months[0]!.categories.map((c) => c.id)).toEqual(['c1a', 'c1b']);
    expect(tree.months[0]!.categories[0]!.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tree.months[0]!.categories[0]!.tasks[0]!.subtasks.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(tree.months[0]!.categories[1]!.tasks.map((t) => t.id)).toEqual(['t3']);
    expect(tree.months[1]!.categories[0]!.tasks.map((t) => t.id)).toEqual(['t4']);
    expect(tree.months[0]!.categories[0]!.tasks[1]!.subtasks).toEqual([]);

    expect(await loadTemplateTree(db, 'tpl_missing')).toBeNull();
  });
});
