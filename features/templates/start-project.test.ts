// features/templates/start-project.test.ts — PUL-506, §15.4 mandatory
//
// Contract test for §13.3.2 `createProjectFromTemplate`, the Start Project wizard's final step.
// Lives in the templates slice (§15.4 lists it there); the action itself is in
// features/projects/actions.ts beside `createProject`, whose guards it shares.
//
// Same rig as create-project.test.ts: the real easygrowcrm_test database, no DB mocks, no mocked
// `authorize()` (§15.8). Only `auth.api.getSession` is stubbed; role and active are still read
// from Postgres.
//
// Fixture: seedFull's "Local SEO Monthly Campaign" (2 months, 16 tasks, subtasks, checklists, an
// `after` rule tt3 → tt2, two `before_deadline` tasks per month). One Month 2 title is rewritten
// in `beforeEach` to carry all three tokens, since no seeded title has {{ProjectName}} or
// {{MonthName}}.
//
// Project: start Thu 2026-09-10, deadline 2026-10-29. Month 2 therefore starts 2026-10-10, an
// October — the {{MonthName}} expectation below.

import { and, count, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  auditLog,
  projects,
  projectTasks,
  taskChecklistItems,
  taskSubtasks,
  templates,
  templateTasks,
} from '../../db/schema';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedFull, type FullSeed } from '../../tests/seed';
import { computeDueDates } from './due-rule-compute';
import { tplAllTasks, type FlatTemplateTask } from './hierarchy';
import { loadTemplateTree } from './queries';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { createProjectFromTemplate } = await import('../projects/actions');

let seed: FullSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

const START = '2026-09-10';
const DEADLINE = '2026-10-29';
const PROJECT_NAME = 'Acme Local SEO';
const TOKEN_TASK = 'seed_tt_tt14'; // Month 2 · "Schema markup implementation"

function input(overrides: Partial<Parameters<typeof createProjectFromTemplate>[0]> = {}) {
  return {
    templateId: seed.templates.localSeo,
    accountId: seed.account.id,
    name: PROJECT_NAME,
    startDate: START,
    deadline: DEADLINE,
    assignments: {
      'SEO Executive': seed.employees[0].id,
      'Content Writer': seed.employees[1].id,
      'Project Manager': null, // explicitly unassigned
      // 'QC' is left out: unmapped
    },
    ...overrides,
  };
}

async function flatTemplate(): Promise<FlatTemplateTask[]> {
  const tree = await loadTemplateTree(db, seed.templates.localSeo);
  if (!tree) throw new Error('seeded template missing');
  return tplAllTasks(tree);
}

/** The title a template task should get, for matching live rows back to template tasks. */
function expectedTitle(t: FlatTemplateTask): string {
  const month = t._monthNum === 1 ? 'September' : 'October';
  return t.title
    .replaceAll('{{ClientName}}', seed.client.name)
    .replaceAll('{{AccountName}}', seed.account.name)
    .replaceAll('{{ProjectName}}', PROJECT_NAME)
    .replaceAll('{{MonthName}}', month);
}

/**
 * The live tasks of a project, keyed by the template task they came from. `project_tasks` has no
 * template-task column, so a row is matched on (month, category, title), which is unique in this
 * template — asserted here so a fixture change cannot make the match silently ambiguous.
 */
async function liveByTemplateTask(projectId: string, flat: FlatTemplateTask[]) {
  const rows = await db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
  const key = (month: number | null, category: string, title: string) =>
    `${month}|${category}|${title}`;
  const byKey = new Map(rows.map((r) => [key(r.month, r.category, r.title), r]));
  expect(byKey.size).toBe(rows.length);

  const out = new Map<string, (typeof rows)[number]>();
  for (const t of flat) {
    const row = byKey.get(key(t._monthNum, t._catName, expectedTitle(t)));
    if (!row) throw new Error(`no live task for ${t.id} (${t.title})`);
    out.set(t.id, row);
  }
  return { rows, byTemplateTask: out };
}

async function tableCounts() {
  const [p] = await db.select({ n: count() }).from(projects);
  const [t] = await db.select({ n: count() }).from(projectTasks);
  const [a] = await db.select({ n: count() }).from(auditLog);
  return { projects: p?.n, tasks: t?.n, audit: a?.n };
}

beforeEach(async () => {
  seed = await seedFull();
  __resetNotifications();
  await db
    .update(templateTasks)
    .set({ title: '{{ClientName}} / {{AccountName}} / {{ProjectName}} / {{MonthName}}' })
    .where(eq(templateTasks.id, TOKEN_TASK));
});

afterEach(() => {
  getSession.mockReset();
});

describe('createProjectFromTemplate (§13.3.2) — the clone', () => {
  it('creates one live task per template task, carrying category and month', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();

    const out = expectOk(await createProjectFromTemplate(input()));
    expect(out.taskCount).toBe(flat.length);
    expect(out.monthCount).toBe(2);

    const { rows, byTemplateTask } = await liveByTemplateTask(out.projectId, flat);
    expect(rows).toHaveLength(flat.length);
    for (const t of flat) {
      const live = byTemplateTask.get(t.id);
      expect(live).toMatchObject({ month: t._monthNum, category: t._catName, status: 'planned' });
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, out.projectId));
    expect(project).toMatchObject({
      name: PROJECT_NAME,
      accountId: seed.account.id,
      startDate: START,
      deadline: DEADLINE,
      templateId: seed.templates.localSeo,
      type: 'SEO', // the template's category (§11.2)
    });
  });

  it('replaces {{ClientName}}, {{AccountName}}, {{ProjectName}} and {{MonthName}} (Month 2 → October)', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();
    const out = expectOk(await createProjectFromTemplate(input()));
    const { rows, byTemplateTask } = await liveByTemplateTask(out.projectId, flat);

    // Amendment M: the partner and the end business are different names, and each token gets
    // its own. The seed uses 'Seed Client' / 'Seed Account', so swapping them would fail here.
    expect(byTemplateTask.get(TOKEN_TASK)?.title).toBe(
      `${seed.client.name} / ${seed.account.name} / ${PROJECT_NAME} / October`,
    );
    // The seed template's end-business titles use {{AccountName}} (PUL-415.5).
    expect(byTemplateTask.get('seed_tt_tt4')?.title).toBe(
      `Service page copy - ${seed.account.name}`,
    );
    for (const r of rows) expect(r.title).not.toContain('{{');
  });

  it('clones subtasks with done=false and checklist items unchecked, in order', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();
    const out = expectOk(await createProjectFromTemplate(input()));
    const { rows, byTemplateTask } = await liveByTemplateTask(out.projectId, flat);
    const liveIds = rows.map((r) => r.id);

    const subtasks = await db
      .select()
      .from(taskSubtasks)
      .where(inArray(taskSubtasks.taskId, liveIds));
    const checklist = await db
      .select()
      .from(taskChecklistItems)
      .where(inArray(taskChecklistItems.taskId, liveIds));

    expect(subtasks).toHaveLength(flat.reduce((n, t) => n + t.subtasks.length, 0));
    expect(checklist).toHaveLength(flat.reduce((n, t) => n + t.checklist.length, 0));
    expect(subtasks.every((s) => s.done === false)).toBe(true);
    expect(checklist.every((c) => c.done === false)).toBe(true);

    const gbp = byTemplateTask.get('seed_tt_tt1')?.id;
    const ordered = <T extends { taskId: string; position: number }>(xs: T[]) =>
      xs.filter((x) => x.taskId === gbp).sort((a, b) => a.position - b.position);
    expect(ordered(subtasks).map((s) => s.text)).toEqual([
      'Research post topics',
      'Write captions',
      'Design post images',
    ]);
    expect(ordered(checklist).map((c) => c.text)).toEqual(['Draft posts', 'Schedule in GBP']);
  });

  it('due dates match computeDueDates, and an after-ref becomes depends_on the new task id', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();
    const out = expectOk(await createProjectFromTemplate(input()));
    const { byTemplateTask } = await liveByTemplateTask(out.projectId, flat);

    const expected = computeDueDates(flat, {
      startDate: START,
      deadline: DEADLINE,
      holidays: new Set(),
    });
    if (!expected.ok) throw new Error('fixture should resolve');
    for (const t of flat) {
      expect(byTemplateTask.get(t.id)?.dueDate, t.id).toBe(expected.dates.get(t.id));
    }

    // tt3 "Build 8 new citations" is `after` tt2 "Audit + fix NAP inconsistencies".
    const tt2 = byTemplateTask.get('seed_tt_tt2');
    const tt3 = byTemplateTask.get('seed_tt_tt3');
    expect(tt3?.dependsOn).toBe(tt2?.id);
    expect(tt3?.dependsOn).toMatch(/^pt_/);
    for (const t of flat) {
      if (t.dueRule.kind !== 'after') expect(byTemplateTask.get(t.id)?.dependsOn).toBeNull();
    }
  });

  it('assigns by role; an unmapped or null-mapped role leaves the task unassigned', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();
    const out = expectOk(await createProjectFromTemplate(input()));
    const { byTemplateTask } = await liveByTemplateTask(out.projectId, flat);

    expect(byTemplateTask.get('seed_tt_tt1')?.assigneeId).toBe(seed.employees[0].id); // SEO Executive
    expect(byTemplateTask.get('seed_tt_tt4')?.assigneeId).toBe(seed.employees[1].id); // Content Writer
    expect(byTemplateTask.get('seed_tt_tt9')?.assigneeId).toBeNull(); // Project Manager → null
    expect(byTemplateTask.get('seed_tt_tt10')?.assigneeId).toBeNull(); // QC, unmapped
    expect(byTemplateTask.get('seed_tt_tt10')?.roleHint).toBe('QC');
  });

  it('audits once for the project and once, batched, for the tasks; notifies per assignee', async () => {
    actAs(seed.projectManager.id);
    const flat = await flatTemplate();
    const out = expectOk(await createProjectFromTemplate(input()));
    const { rows } = await liveByTemplateTask(out.projectId, flat);

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resourceId, out.projectId));
    expect(audit.map((a) => a.action).sort()).toEqual([
      'project.created_from_template',
      'project_task.created',
    ]);
    const batch = audit.find((a) => a.action === 'project_task.created');
    expect((batch?.after as { taskIds: string[] }).taskIds.sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );

    const assigned = __sentNotifications().filter((n) => n.type === 'task_assigned');
    const seoTasks = rows.filter((r) => r.assigneeId === seed.employees[0].id).map((r) => r.id);
    expect(assigned.map((n) => n.to).sort()).toEqual(
      [seed.employees[0].id, seed.employees[1].id].sort(),
    );
    const toSeo = assigned.find((n) => n.to === seed.employees[0].id);
    expect((toSeo?.data?.taskIds as string[]).sort()).toEqual(seoTasks.sort());
    expect(__sentNotifications().some((n) => n.type === 'project_started')).toBe(true);
  });
});

describe('createProjectFromTemplate (§13.3.2) — refusals', () => {
  it('a before_deadline task with no deadline → GATE:no_deadline, and nothing is written', async () => {
    actAs(seed.projectManager.id);
    const before = await tableCounts();

    const fail = expectFail(
      await createProjectFromTemplate(input({ deadline: undefined })),
      'GATE',
      'no_deadline',
    );
    // tt9 "Monthly report" is the first before_deadline task in walk order.
    expect(fail.details).toMatchObject({ templateTaskId: 'seed_tt_tt9' });

    expect(await tableCounts()).toEqual(before);
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('a soft-deleted template → NOT_FOUND', async () => {
    actAs(seed.projectManager.id);
    await db
      .update(templates)
      .set({ deletedAt: new Date('2026-09-01T00:00:00Z') })
      .where(eq(templates.id, seed.templates.localSeo));

    expectFail(await createProjectFromTemplate(input()), 'NOT_FOUND');
    const [row] = await db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.templateId, seed.templates.localSeo)));
    expect(row?.n).toBe(0);
  });

  it('an employee is denied', async () => {
    actAs(seed.employees[0].id);
    expectFail(await createProjectFromTemplate(input()), 'FORBIDDEN');
  });

  it('a super admin named for a role → GATE:sa_assignee', async () => {
    actAs(seed.projectManager.id);
    expectFail(
      await createProjectFromTemplate(input({ assignments: { QC: seed.superAdmin.id } })),
      'GATE',
      'sa_assignee',
    );
  });
});
