// features/projects/archive-project.test.ts
//
// Contract test for §13.3.4 `archiveProject` (PUL-402 Stage 2).
//
// Same rig as create-project.test.ts: the real easygrowcrm_test database, no DB mocks and no
// mocked `authorize()` (§15.8). The only stub is `auth.api.getSession`.
//
// NOTE on the fixture: `seedMinimal` seeds `pt_seed_3` as `submitted` on `proj_seed`
// (PUL-401.4), so the project starts out BLOCKED by the pending-reviews gate. Cases that need
// a clean archive clear that task first — deliberately, so the gate is the default state and
// the happy path has to earn it rather than the other way round.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { auditLog, projectTasks, projects } from '../../db/schema';
import { clock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { archiveProject, updateProject } = await import('./actions');

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

/** Move the seeded `submitted` task out of the way so the project can legally archive. */
async function clearPendingReviews() {
  await db
    .update(projectTasks)
    .set({ status: 'approved' })
    .where(eq(projectTasks.projectId, seed.project.id));
}

beforeEach(async () => {
  seed = await seedMinimal();
});

afterEach(() => {
  getSession.mockReset();
});

describe('archiveProject (§13.3.4)', () => {
  it('flips status to archived and audits it, for a manager', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();

    expectOk(await archiveProject({ projectId: seed.project.id }));

    const row = await target();
    expect(row.status).toBe('archived');
    // Archive is NOT a soft delete — the row stays fully present (§13.3.5 owns deletion).
    expect(row.deletedAt).toBeNull();

    const audit = await auditFor('project.archived');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      resourceType: 'project',
      before: { status: 'active' },
      after: { status: 'archived' },
    });
  });

  it('blocks with GATE:pending_reviews and NAMES the blocking task', async () => {
    actAs(seed.teamLeader.id);

    // `pt_seed_3` ("Seed Task Submitted") is submitted straight out of the fixture.
    const failure = expectFail(
      await archiveProject({ projectId: seed.project.id }),
      'GATE',
      'pending_reviews',
    );

    // The done-when: the toast must be able to name the task, not say "some task".
    expect(failure.message).toContain('Seed Task Submitted');
    expect(failure.details).toMatchObject({
      taskId: seed.tasks[2].id,
      taskTitle: 'Seed Task Submitted',
    });

    // Blocked means blocked: no status change, no audit row.
    expect((await target()).status).toBe('active');
    expect(await auditFor('project.archived')).toHaveLength(0);
  });

  it('ignores submitted tasks belonging to a different project', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();

    // A submitted task on another project must not block this one — proves the gate's
    // project_id filter is real and not a table-wide "any submitted task anywhere" scan.
    const [other] = await db
      .insert(projects)
      .values({
        id: 'prj_other',
        clientId: seed.client.id,
        name: 'Other Project',
        type: 'One-off',
        startDate: '2026-01-01',
        createdBy: seed.projectManager.id,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .returning();

    await db.insert(projectTasks).values({
      id: 'pt_other_submitted',
      projectId: other.id,
      category: 'Content',
      title: 'Someone else problem',
      status: 'submitted',
      createdBy: seed.projectManager.id,
    });

    expectOk(await archiveProject({ projectId: seed.project.id }));
    expect((await target()).status).toBe('archived');
  });

  it('ignores a soft-deleted submitted task', async () => {
    actAs(seed.projectManager.id);

    // The seeded submitted task is soft-deleted rather than decided — a deleted task is not
    // awaiting anyone's review, so it must not hold the project hostage.
    await db
      .update(projectTasks)
      .set({ deletedAt: clock.now() })
      .where(eq(projectTasks.id, seed.tasks[2].id));

    expectOk(await archiveProject({ projectId: seed.project.id }));
    expect((await target()).status).toBe('archived');
  });

  it('re-archiving is a silent no-op with no second audit row', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();

    expectOk(await archiveProject({ projectId: seed.project.id }));
    expectOk(await archiveProject({ projectId: seed.project.id }));

    expect(await auditFor('project.archived')).toHaveLength(1);
  });

  it('denies a plain employee with FORBIDDEN', async () => {
    actAs(seed.employees[0].id);
    await clearPendingReviews();

    expectFail(await archiveProject({ projectId: seed.project.id }), 'FORBIDDEN');

    expect((await target()).status).toBe('active');
    expect(await auditFor('project.archived')).toHaveLength(0);
  });

  it('rejects a nonexistent project with NOT_FOUND', async () => {
    actAs(seed.projectManager.id);

    expectFail(await archiveProject({ projectId: 'prj_nope' }), 'NOT_FOUND');
  });

  it('makes the project content-read-only: updateProject → GATE:project_archived', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();
    expectOk(await archiveProject({ projectId: seed.project.id }));

    const failure = expectFail(
      await updateProject({ projectId: seed.project.id, name: 'Renamed While Archived' }),
      'GATE',
      'project_archived',
    );
    expect(failure.details).toMatchObject({ projectId: seed.project.id });

    // Untouched, and no spurious project.updated row.
    expect((await target()).name).toBe(seed.project.name);
    expect(await auditFor('project.updated')).toHaveLength(0);
  });

  it('refuses an archived project even when the edit would change nothing', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();
    expectOk(await archiveProject({ projectId: seed.project.id }));

    // The guard runs BEFORE the diff, so a no-op payload is refused rather than silently
    // "succeeding" — otherwise an archived project would appear editable to the UI.
    expectFail(
      await updateProject({ projectId: seed.project.id, name: seed.project.name }),
      'GATE',
      'project_archived',
    );
  });

  it('drops the archived project from pickers but keeps it in the admin list', async () => {
    actAs(seed.projectManager.id);
    await clearPendingReviews();
    expectOk(await archiveProject({ projectId: seed.project.id }));

    const { activeProjectsQuery, projectsListQuery } = await import('./queries');

    expect((await activeProjectsQuery()).map((p) => p.id)).not.toContain(seed.project.id);
    expect((await projectsListQuery()).map((p) => p.id)).toContain(seed.project.id);
  });
});
