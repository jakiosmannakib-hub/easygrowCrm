// features/projects/unarchive-project.test.ts
//
// Contract test for §13.3.4's reverse, `unarchiveProject` (PUL-402 Stage 2).
//
// Same rig as archive-project.test.ts. Note `project.unarchive` is a permission key §9.6 does
// not list — §13.3.4 defines the action and says "same actors", so it was added to lib/authz.ts
// encoded exactly like `project.archive` (and to the §9.6 transcription in
// features/auth/authorize.test.ts, which asserts the cell).

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, projects } from '../../db/schema';
import { clock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { unarchiveProject, updateProject } = await import('./actions');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function target() {
  const rows = await db.select().from(projects).where(eq(projects.id, seed.project.id)).limit(1);
  return rows[0];
}

async function auditFor(action: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.resourceId, seed.project.id), eq(auditLog.action, action)));
}

/**
 * Put the project into the archived state directly, rather than by calling `archiveProject`.
 * These cases are about un-archiving; routing the arrange step through the other action would
 * make them fail for that action's reasons (the pending-reviews gate) instead of their own.
 */
async function preArchive() {
  await db
    .update(projects)
    .set({ status: 'archived', updatedAt: clock.now() })
    .where(eq(projects.id, seed.project.id));
}

beforeEach(async () => {
  seed = await seedMinimal();
});

afterEach(() => {
  getSession.mockReset();
});

describe('unarchiveProject (§13.3.4 reverse)', () => {
  it('flips status back to active and audits it, for a manager', async () => {
    actAs(seed.projectManager.id);
    await preArchive();

    expectOk(await unarchiveProject({ projectId: seed.project.id }));

    expect((await target()).status).toBe('active');

    const audit = await auditFor('project.unarchived');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      resourceType: 'project',
      before: { status: 'archived' },
      after: { status: 'active' },
    });
  });

  it('restores it to pickers and makes it editable again', async () => {
    actAs(seed.teamLeader.id);
    await preArchive();

    // Archived → the update guard bites.
    expectFail(
      await updateProject({ projectId: seed.project.id, name: 'Too Soon' }),
      'GATE',
      'project_archived',
    );

    expectOk(await unarchiveProject({ projectId: seed.project.id }));

    // Active again → the same edit now lands. This is the round trip that matters: archiving
    // must be reversible in full, not just in the status column.
    expectOk(await updateProject({ projectId: seed.project.id, name: 'Now Allowed' }));
    expect((await target()).name).toBe('Now Allowed');

    const { activeProjectsQuery } = await import('./queries');
    expect((await activeProjectsQuery()).map((p) => p.id)).toContain(seed.project.id);
  });

  it('un-archiving an already-active project is a silent no-op with no audit row', async () => {
    actAs(seed.projectManager.id);

    // The fixture's project is already active.
    expectOk(await unarchiveProject({ projectId: seed.project.id }));

    expect((await target()).status).toBe('active');
    expect(await auditFor('project.unarchived')).toHaveLength(0);
  });

  it('does not restore a submitted task or otherwise touch tasks', async () => {
    actAs(seed.projectManager.id);
    await preArchive();

    const { projectTasks } = await import('../../db/schema');
    const before = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, seed.project.id));

    expectOk(await unarchiveProject({ projectId: seed.project.id }));

    // Archiving never changed the tasks, so un-archiving must not either — status is the only
    // column either action owns.
    const after = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, seed.project.id));
    expect(after).toEqual(before);
  });

  it('denies a plain employee with FORBIDDEN', async () => {
    actAs(seed.employees[0].id);
    await preArchive();

    expectFail(await unarchiveProject({ projectId: seed.project.id }), 'FORBIDDEN');

    expect((await target()).status).toBe('archived');
    expect(await auditFor('project.unarchived')).toHaveLength(0);
  });

  it('denies HR with FORBIDDEN — same audience as archive (§13.3.4 "same actors")', async () => {
    const { user: userTable } = await import('../../db/schema');
    await db
      .update(userTable)
      .set({ role: 'admin_hr' })
      .where(eq(userTable.id, seed.employees[1].id));
    actAs(seed.employees[1].id);
    await preArchive();

    expectFail(await unarchiveProject({ projectId: seed.project.id }), 'FORBIDDEN');
  });

  it('rejects a nonexistent project with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(await unarchiveProject({ projectId: 'prj_nope' }), 'NOT_FOUND');
  });

  it('rejects a soft-deleted project with NOT_FOUND — delete is not archive', async () => {
    actAs(seed.projectManager.id);
    await preArchive();
    await db
      .update(projects)
      .set({ deletedAt: clock.now() })
      .where(eq(projects.id, seed.project.id));

    expectFail(await unarchiveProject({ projectId: seed.project.id }), 'NOT_FOUND');
  });
});
