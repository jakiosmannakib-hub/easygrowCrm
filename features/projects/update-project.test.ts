// features/projects/update-project.test.ts
//
// Contract test for §13.3.3 `updateProject` (PUL-402 Stage 1).
//
// Same rig as create-project.test.ts and update-employee.test.ts: the real easygrowcrm_test
// database, no DB mocks, no mocked `authorize()` (§15.8). The only stub is
// `auth.api.getSession`.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { accounts, auditLog, clients, projects } from '../../db/schema';
import { clock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { updateProject } = await import('./actions');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/**
 * The project every case edits. `seedMinimal` already seeds `proj_seed` (PUL-401.4), so this
 * reads that row rather than creating a second one.
 */
async function target() {
  const rows = await db.select().from(projects).where(eq(projects.id, seed.project.id)).limit(1);
  return rows[0];
}

async function auditFor(projectId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.resourceId, projectId), eq(auditLog.action, 'project.updated')));
}

/**
 * A second account to move the project onto (Amendment M: `updateProject` moves a project
 * between accounts). `archived` archives the account itself; `clientArchived` puts a live
 * account under an archived client, which `requireLiveAccount` must refuse too.
 */
async function secondAccount(state: 'live' | 'archived' | 'clientArchived' = 'live') {
  const [client] = await db
    .insert(clients)
    .values({
      id: `cli_second_${state}`,
      name: `Second Client (${state})`,
      ...(state === 'clientArchived' ? { deletedAt: clock.now() } : {}),
    })
    .returning();
  const [row] = await db
    .insert(accounts)
    .values({
      id: `acc_second_${state}`,
      clientId: client.id,
      name: `Second Account (${state})`,
      ...(state === 'archived' ? { deletedAt: clock.now() } : {}),
    })
    .returning();
  return row;
}

beforeEach(async () => {
  seed = await seedMinimal();
});

afterEach(() => {
  getSession.mockReset();
});

describe('updateProject (§13.3.3)', () => {
  it('writes the changed fields and audits exactly that diff', async () => {
    actAs(seed.projectManager.id);

    const before = await target();

    // Start date and client are posted back unchanged — a real form sends the whole row.
    expectOk(
      await updateProject({
        projectId: seed.project.id,
        name: 'Renamed Retainer',
        accountId: before.accountId,
        startDate: before.startDate,
        deadline: '2027-01-31',
      }),
    );

    expect(await target()).toMatchObject({
      name: 'Renamed Retainer',
      deadline: '2027-01-31',
      accountId: before.accountId,
      startDate: before.startDate,
    });

    const audit = await auditFor(seed.project.id);
    expect(audit).toHaveLength(1);

    // Only the two fields that moved — not the two posted back unchanged.
    expect(audit[0].before).toEqual({ name: before.name, deadline: before.deadline });
    expect(audit[0].after).toEqual({ name: 'Renamed Retainer', deadline: '2027-01-31' });
  });

  it('is a no-op when nothing changed: no UPDATE, no second audit row', async () => {
    actAs(seed.teamLeader.id);

    const before = await target();

    expectOk(
      await updateProject({
        projectId: seed.project.id,
        name: before.name,
        accountId: before.accountId,
        startDate: before.startDate,
        deadline: before.deadline,
      }),
    );

    const after = await target();
    expect(await auditFor(seed.project.id)).toHaveLength(0);
    // updated_at is not bumped either — a no-op must leave no trace at all.
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('clears a nullable deadline when explicitly sent null', async () => {
    actAs(seed.projectManager.id);

    expectOk(await updateProject({ projectId: seed.project.id, deadline: null }));

    expect((await target()).deadline).toBeNull();

    const audit = await auditFor(seed.project.id);
    expect(audit[0].after).toEqual({ deadline: null });
  });

  it('moves the project to another live account, and audits the move', async () => {
    actAs(seed.projectManager.id);
    const other = await secondAccount();

    expectOk(await updateProject({ projectId: seed.project.id, accountId: other.id }));

    expect((await target()).accountId).toBe(other.id);
    const audit = await auditFor(seed.project.id);
    expect(audit[0].before).toEqual({ accountId: seed.account.id });
    expect(audit[0].after).toEqual({ accountId: other.id });
  });

  it('rejects a payload with no editable field (the refine)', async () => {
    actAs(seed.projectManager.id);

    // The type CANNOT catch this — every editable field is optional, so `{ projectId }` is a
    // well-typed payload. The `.refine()` is the only thing standing between a caller bug and
    // a silent no-op, which is why it is worth a test.
    //
    // Still a THROW, not an ActionResult, and deliberately so (PUL-111): the empty payload
    // fails `UpdateProjectInput.parse`, and a ZodError is not an AppError, so `actionResult`
    // re-throws it. Same convention as updateEmployee / updateClient — see
    // update-employee.test.ts.
    await expect(updateProject({ projectId: seed.project.id })).rejects.toThrow();
  });

  it('rejects a nonexistent project with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(
      await updateProject({ projectId: 'prj_nope', name: 'Whatever' }),
      'NOT_FOUND',
    );
  });

  it('rejects a soft-deleted project with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    await db
      .update(projects)
      .set({ deletedAt: clock.now() })
      .where(eq(projects.id, seed.project.id));

    expectFail(
      await updateProject({ projectId: seed.project.id, name: 'Resurrected' }),
      'NOT_FOUND',
    );

    // Still deleted, still not renamed.
    expect((await target()).name).toBe(seed.project.name);
  });

  it.each(['archived', 'clientArchived'] as const)(
    'rejects moving the project onto an unusable account (%s) with NOT_FOUND',
    async (state) => {
      actAs(seed.projectManager.id);
      const unusable = await secondAccount(state);

      expectFail(
        await updateProject({ projectId: seed.project.id, accountId: unusable.id }),
        'NOT_FOUND',
      );

      // The guard ran before the UPDATE — the project still points at its original account.
      expect((await target()).accountId).toBe(seed.account.id);
      expect(await auditFor(seed.project.id)).toHaveLength(0);
    },
  );

  it('denies a plain employee with FORBIDDEN', async () => {
    actAs(seed.employees[0].id);

    expectFail(
      await updateProject({ projectId: seed.project.id, name: 'Employee Rename' }),
      'FORBIDDEN',
    );

    // The deny is real, not a short-circuit: the row is untouched.
    expect((await target()).name).toBe(seed.project.name);
  });

  it('does NOT recompute task due dates when the deadline changes (§13.3.3)', async () => {
    actAs(seed.projectManager.id);

    // The seeded tasks carry no due dates, so "unchanged" here means the action wrote nothing
    // to project_tasks at all — which is the guard §13.3.3 actually specifies. If a future
    // edit adds a cascade, this comparison is what catches it.
    const { projectTasks } = await import('../../db/schema');
    const tasksBefore = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, seed.project.id));

    expectOk(await updateProject({ projectId: seed.project.id, deadline: '2028-12-31' }));

    const tasksAfter = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, seed.project.id));

    expect(tasksAfter).toEqual(tasksBefore);
  });
});
