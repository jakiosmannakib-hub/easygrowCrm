// features/projects/create-project.test.ts
//
// Contract test for §13.3.1 `createProject` (PUL-402 Stage 1).
//
// Same rig as create-employee.test.ts: the real easygrowcrm_test database, no DB mocks and no
// mocked `authorize()` (§15.8). The only stub is `auth.api.getSession`, the HTTP session
// envelope, because a vitest node run has no request carrying a cookie. `getSessionUser()`
// underneath still re-reads `role` and `active` from Postgres on every call (§16.5), so the
// authz cases below are decided by actual database rows.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, clients, projects, user as userTable } from '../../db/schema';
import { clock } from '../../lib/clock';
import { __resetNotifications, __sentNotifications } from '../../lib/notifications';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { createProject } = await import('./actions');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/**
 * Dates derive from the clock port, never `new Date()` (§16.6) — so a frozen clock moves the
 * fixture with it rather than leaving the test anchored to whenever it happened to run.
 * `toISOString().slice(0, 10)` is the YYYY-MM-DD form the column and the schema both use.
 */
function today(): string {
  return clock.now().toISOString().slice(0, 10);
}

function newProject(overrides: Partial<Parameters<typeof createProject>[0]> = {}) {
  return {
    clientId: seed.client.id,
    name: 'Acme Q1 Retainer',
    type: 'Retainer',
    startDate: today(),
    ...overrides,
  };
}

async function auditFor(projectId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, projectId));
}

beforeEach(async () => {
  seed = await seedMinimal();
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
});

describe('createProject (§13.3.1)', () => {
  it('creates the project and audits it, for a manager', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(await createProject(newProject()));

    expect(created).toMatchObject({
      clientId: seed.client.id,
      name: 'Acme Q1 Retainer',
      type: 'Retainer',
      startDate: today(),
      deadline: null,
      // Not written by the action — the column default IS the spec (§11.2).
      status: 'active',
      createdBy: seed.projectManager.id,
    });
    expect(created.id).toMatch(/^prj_/);

    const [row] = await db.select().from(projects).where(eq(projects.id, created.id));
    expect(row).toBeDefined();

    const audit = await auditFor(created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'project.created',
      resourceType: 'project',
      before: null,
    });
  });

  it('stores an optional deadline as a plain YYYY-MM-DD string', async () => {
    actAs(seed.teamLeader.id);

    const created = expectOk(
      await createProject(newProject({ startDate: '2026-02-01', deadline: '2026-06-30' })),
    );

    // Strings end to end (§11.0) — a Date here is how a Dhaka day silently shifts.
    expect(created.startDate).toBe('2026-02-01');
    expect(created.deadline).toBe('2026-06-30');
    expect(typeof created.deadline).toBe('string');
  });

  it('notifies every active manager, and nobody else (N:project_started)', async () => {
    actAs(seed.projectManager.id);

    expectOk(await createProject(newProject()));

    const sent = __sentNotifications();
    expect(sent.every((n) => n.type === 'project_started')).toBe(true);

    // SA + TL + PM are the three manager-level roles; the three employees are not.
    expect(new Set(sent.map((n) => n.to))).toEqual(
      new Set([seed.superAdmin.id, seed.teamLeader.id, seed.projectManager.id]),
    );
  });

  it('denies a plain employee with FORBIDDEN', async () => {
    actAs(seed.employees[0].id);

    expectFail(await createProject(newProject()), 'FORBIDDEN');

    // The deny is real, not a short-circuit: nothing was written.
    expect(await db.select().from(projects).where(eq(projects.name, 'Acme Q1 Retainer'))).toEqual(
      [],
    );
  });

  it('denies HR with FORBIDDEN — project.create is delivery, not people-ops', async () => {
    // admin_hr is manager-level for employees but denied on projects (§9.6). Asserting it
    // here stops a future "managers can do project things" simplification from widening the
    // cell without anyone noticing.
    const [hr] = await db
      .insert(userTable)
      .values({
        id: 'seed_hr_proj',
        name: 'Seed HR',
        email: 'hr-proj@test.local',
        role: 'admin_hr',
        active: true,
        emailVerified: true,
      })
      .returning();

    actAs(hr.id);

    expectFail(await createProject(newProject()), 'FORBIDDEN');
  });

  it('rejects a nonexistent client with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(await createProject(newProject({ clientId: 'cli_does_not_exist' })), 'NOT_FOUND');
  });

  it('rejects an archived client with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    await db
      .update(clients)
      .set({ deletedAt: clock.now() })
      .where(eq(clients.id, seed.client.id));

    expectFail(await createProject(newProject()), 'NOT_FOUND');

    // The guard ran before the insert — no orphan project pointing at an archived client.
    expect(await db.select().from(projects).where(eq(projects.name, 'Acme Q1 Retainer'))).toEqual(
      [],
    );
  });

  it('rejects an empty name at the validation step', async () => {
    actAs(seed.projectManager.id);

    // A ZodError, not an AppError, so `actionResult` re-throws it rather than returning a
    // typed result — the same convention as updateEmployee / updateClient (PUL-111).
    await expect(createProject(newProject({ name: '' }))).rejects.toThrow();
  });

  it('rejects a deadline before the start date at the DB CHECK — as an unhandled throw', async () => {
    actAs(seed.projectManager.id);

    // `deadline_after_start` (migration 0005) is the only enforcement. It fires as a Postgres
    // error, not an AppError, so `actionResult` re-throws it by design rather than returning
    // `{ ok: false }` (lib/action-result.ts). This test pins that ACTUAL behaviour rather than
    // the behaviour we might prefer: the data is protected, but the caller gets an opaque
    // crash instead of a typed VALIDATION result.
    //
    // TODO(PUL-402 Stage 2): add a cross-field `.refine()` to CreateProjectInput so the form
    // path returns VALIDATION. The CHECK stays as the backstop for non-form writers.
    await expect(
      createProject(newProject({ startDate: '2026-06-01', deadline: '2026-01-01' })),
    ).rejects.toThrow();

    expect(await db.select().from(projects).where(eq(projects.name, 'Acme Q1 Retainer'))).toEqual(
      [],
    );
  });
});
