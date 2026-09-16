// tests/seed.ts — PUL-109
//
// Fixtures for the test database. Every test that needs a cast of users calls
// `seedMinimal()`; nothing here ever runs outside a database whose name contains "test"
// (see `assertTestDb`).
//
// SCOPE (intentional deviation from §15.5, PUL-109): §15.5's seedMinimal is "1 SA, 2 managers,
// 3 employees, 1 client, 1 project". The user cast + guard + reset landed first; the client
// joined in PUL-207 (migration 0004). The project waits for PUL-401, which appends it here.

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { clients, user } from '../db/schema';

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

  await db.execute(
    sql`TRUNCATE TABLE "audit_log", "clients", "session", "account", "verification", "user" RESTART IDENTITY CASCADE`,
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

export interface MinimalSeed {
  superAdmin: SeededUser;
  teamLeader: SeededUser;
  projectManager: SeededUser;
  employees: [SeededUser, SeededUser, SeededUser];
  client: SeededClient;
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
 * One non-archived client (PUL-207). The project row joins when `projects` exists (PUL-401).
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
  return { superAdmin, teamLeader, projectManager, employees: [e1, e2, e3], client };
}

/**
 * The realistic org for flow tests.
 *
 * Skeleton. Becomes the realistic org (§15.5) when flow tests + Phase 2 tables land — no Phase 2
 * data is invented here. It delegates to `seedMinimal` so it already returns usable handles and
 * callers written against it keep working when it grows.
 */
export async function seedFull(): Promise<MinimalSeed> {
  assertTestDb();
  return seedMinimal();
}
