// tests/seed.ts — PUL-109
//
// Fixtures for the test database. Every test that needs a cast of users calls
// `seedMinimal()`; nothing here ever runs outside a database whose name contains "test"
// (see `assertTestDb`).
//
// SCOPE: §15.5's seedMinimal is "1 SA, 2 managers, 3 employees, 1 client, 1 project". It was
// filled in across three tickets: the user cast + guard + reset in PUL-109, the client in
// PUL-207 (migration 0004), and the project — plus its tasks — in PUL-401 (migration 0006).
// The §15.5 shape is now complete; later phases extend it as their tables land.

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { clients, projects, projectTasks, user } from '../db/schema';

/**
 * True iff a database name is a test database.
 *
 * Pure and deliberately crude: a substring check is the rule the whole guard rests on, so it
 * must be trivially auditable. The cost of a false negative is an inconvenience; the cost of a
 * false positive is a truncated dev or production database.
 */
export function isTestDbName(name: string): boolean {
  return name.includes('test');
}

/**
 * Refuse to touch anything that isn't a test database. Called at the top of EVERY seed
 * function — this is the single thing standing between a stray `pnpm test` and a wiped
 * dev database, so it is checked per call rather than once at import time.
 */
export function assertTestDb(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Refusing to seed: DATABASE_URL is not set');

  // The database name is the last path segment, minus any query string.
  const name = new URL(url).pathname.replace(/^\//, '').split('?')[0];

  if (!isTestDbName(name)) {
    throw new Error("Refusing to seed: DATABASE_URL is not a test database (name must contain 'test')");
  }
}

/**
 * Empty every table a seed touches, so each fixture starts from a known state.
 *
 * TRUNCATE is not blocked by the audit_log append-only trigger: that trigger is FOR EACH ROW
 * on UPDATE OR DELETE (db/migrations/0002_audit_log.sql), and TRUNCATE is a separate event
 * that fires neither. The append-only guarantee is about rewriting history through the
 * application; wiping a test database is not that. `tests/seed.test.ts` proves TRUNCATE
 * still succeeds with audit rows present, so a future trigger change can't silently break it.
 *
 * CASCADE covers session/account rows hanging off `user` even as more tables land.
 */
export async function reset(): Promise<void> {
  assertTestDb();

  // Listed children-first so the statement reads in FK order, though TRUNCATE takes them all in
  // one statement and CASCADE would reach the children anyway. Being explicit means a new table
  // that nothing references yet still gets wiped instead of quietly surviving a reset.
  await db.execute(
    sql`TRUNCATE TABLE "audit_log", "task_comments", "task_subtasks", "task_checklist_items", "project_tasks", "projects", "personal_tasks", "clients", "session", "account", "verification", "user" RESTART IDENTITY CASCADE`,
  );
}

export interface SeededUser {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'team_leader' | 'project_manager' | 'admin_hr' | 'employee';
}

export interface SeededClient {
  id: string;
  name: string;
}

export interface SeededProject {
  id: string;
  name: string;
}

export interface SeededTask {
  id: string;
  title: string;
}

export interface MinimalSeed {
  superAdmin: SeededUser;
  teamLeader: SeededUser;
  projectManager: SeededUser;
  employees: [SeededUser, SeededUser, SeededUser];
  client: SeededClient;
  project: SeededProject;
  tasks: [SeededTask, SeededTask, SeededTask];
}

export interface FullSeed extends MinimalSeed {
  /** The extra engagement seedFull adds on top of the minimal cast. */
  secondProject: SeededProject;
  /** seedFull's extra tasks — the minimal three are still in `tasks`. */
  extraTasks: [SeededTask, SeededTask, SeededTask];
}

/**
 * The minimal cast: 1 super admin, 2 managers, 3 employees (§15.5).
 *
 * "2 managers" is read as team_leader + project_manager — the two delivery manager roles, the
 * ones the permission table (§9.6) actually distinguishes for task and project work, and the
 * two the "≥2 active manager-level users" invariant is about. admin_hr is a manager-level role
 * too but is not part of the minimal cast: it carries an orthogonal (people-ops) permission
 * set, so a test that needs it should add one explicitly rather than get it by accident.
 *
 * Ids and emails are deterministic so a failing test names a recognisable user rather than a
 * random uuid. All users are active with email_verified true — the deactivated and unverified
 * cases are what individual tests set up, never the shared fixture.
 *
 * One non-archived client (PUL-207), one active project under it, and three tasks on that
 * project (PUL-401) — which completes §15.5's "1 client, 1 project" cast.
 *
 * The three tasks vary deliberately: one unassigned and `planned`, one assigned to an employee
 * and `in_progress`, one assigned to the TL and `submitted` — so the review queue and the
 * `pt_review_q_idx` partial index have something to match without a test arranging it.
 *
 * **No task is ever assigned to `seed_sa`.** The `pt_no_sa_assignee` trigger (migration 0006)
 * rejects it, so seeding one would fail every suite at fixture time. Assignees come from the
 * TL / PM / employee seeds, or stay NULL.
 */
export async function seedMinimal(): Promise<MinimalSeed> {
  assertTestDb();
  await reset();

  const cast: SeededUser[] = [
    { id: 'seed_sa', name: 'Seed SuperAdmin', email: 'sa@test.local', role: 'super_admin' },
    { id: 'seed_tl', name: 'Seed TeamLeader', email: 'tl@test.local', role: 'team_leader' },
    { id: 'seed_pm', name: 'Seed ProjectManager', email: 'pm@test.local', role: 'project_manager' },
    { id: 'seed_e1', name: 'Seed Employee One', email: 'e1@test.local', role: 'employee' },
    { id: 'seed_e2', name: 'Seed Employee Two', email: 'e2@test.local', role: 'employee' },
    { id: 'seed_e3', name: 'Seed Employee Three', email: 'e3@test.local', role: 'employee' },
  ];

  await db.insert(user).values(
    cast.map((u) => ({ ...u, emailVerified: true, active: true })),
  );

  const client: SeededClient = { id: 'seed_client', name: 'Seed Client' };
  await db.insert(clients).values(client);

  const [superAdmin, teamLeader, projectManager, e1, e2, e3] = cast;

  const project: SeededProject = { id: 'proj_seed', name: 'Seed Retainer' };
  await db.insert(projects).values({
    ...project,
    clientId: client.id,
    type: 'Retainer',
    startDate: '2026-01-01',
    deadline: '2026-12-31',
    createdBy: projectManager.id,
  });

  const tasks: [SeededTask, SeededTask, SeededTask] = [
    { id: 'pt_seed_1', title: 'Seed Task Planned' },
    { id: 'pt_seed_2', title: 'Seed Task In Progress' },
    { id: 'pt_seed_3', title: 'Seed Task Submitted' },
  ];

  await db.insert(projectTasks).values([
    {
      ...tasks[0],
      projectId: project.id,
      month: 1,
      category: 'On-page SEO',
      assigneeId: null, // unassigned/claimable
      status: 'planned' as const,
      priority: 'low' as const,
      createdBy: projectManager.id,
    },
    {
      ...tasks[1],
      projectId: project.id,
      month: 1,
      category: 'Content',
      assigneeId: e1.id,
      status: 'in_progress' as const,
      priority: 'medium' as const,
      createdBy: projectManager.id,
    },
    {
      ...tasks[2],
      projectId: project.id,
      month: 1,
      category: 'Technical SEO',
      assigneeId: teamLeader.id,
      status: 'submitted' as const,
      priority: 'high' as const,
      createdBy: projectManager.id,
    },
  ]);

  return {
    superAdmin,
    teamLeader,
    projectManager,
    employees: [e1, e2, e3],
    client,
    project,
    tasks,
  };
}

/**
 * The realistic org for flow tests.
 *
 * Still built on `seedMinimal` — same cast, same client, same three tasks — so callers written
 * against the minimal handles keep working. PUL-401 adds the second engagement on top: another
 * project under the same client and three more tasks, this time spread across a second month
 * and the PM/employee assignees, so multi-project reads (the board's project filter, workload
 * by assignee) have more than one row to distinguish.
 *
 * Deliberately not a full org yet: no attendance, leave, or template rows, because those tables
 * do not exist. Each phase extends this in proportion to what it lands.
 */
export async function seedFull(): Promise<FullSeed> {
  assertTestDb();
  const minimal = await seedMinimal();

  const secondProject: SeededProject = { id: 'proj_seed_2', name: 'Seed One-off' };
  await db.insert(projects).values({
    ...secondProject,
    clientId: minimal.client.id,
    type: 'One-off',
    startDate: '2026-03-01',
    deadline: null, // the nullable-deadline path, exercised by the fixture itself
    createdBy: minimal.teamLeader.id,
  });

  const extraTasks: [SeededTask, SeededTask, SeededTask] = [
    { id: 'pt_seed_4', title: 'Seed Task Approved' },
    { id: 'pt_seed_5', title: 'Seed Task Revision' },
    { id: 'pt_seed_6', title: 'Seed Task Unassigned Urgent' },
  ];

  await db.insert(projectTasks).values([
    {
      ...extraTasks[0],
      projectId: secondProject.id,
      month: 2,
      category: 'Audit',
      assigneeId: minimal.employees[1].id,
      status: 'approved' as const,
      priority: 'medium' as const,
      createdBy: minimal.teamLeader.id,
    },
    {
      ...extraTasks[1],
      projectId: secondProject.id,
      month: 2,
      category: 'Link Building',
      assigneeId: minimal.employees[2].id,
      status: 'revision_required' as const,
      priority: 'high' as const,
      createdBy: minimal.teamLeader.id,
    },
    {
      ...extraTasks[2],
      projectId: secondProject.id,
      month: 2,
      category: 'Reporting',
      assigneeId: null,
      status: 'planned' as const,
      priority: 'urgent' as const,
      createdBy: minimal.projectManager.id,
    },
  ]);

  return { ...minimal, secondProject, extraTasks };
}
