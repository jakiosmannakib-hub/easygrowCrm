// features/clients/clients.test.ts
//
// Contract test for §13.2 `createClient` / `updateClient` / `archiveClient` (PUL-207.4).
//
// Same rig as the employees tests: the real easygrowcrm_test database, no DB mocks and no
// mocked `authorize()` (§15.8). The only stub is `auth.api.getSession`, the HTTP session
// envelope; `getSessionUser()` still re-reads `role` and `active` from Postgres (§16.5), so
// every authz case is decided by an actual database row. Time is frozen through the clock port.

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { accounts, auditLog, clients, projects, user as userTable } from '../../db/schema';
import { authorize } from '../../lib/authz';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { archiveClient, createClient, updateClient } = await import('./actions');
const { activeClientsQuery, clientsListQuery, getClientProjectUsage } = await import('./queries');

const NOW = new Date('2026-09-15T04:00:00.000Z');

let seed: MinimalSeed;

/** Sign in as a seeded user for the duration of one test. */
function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

/** The seeded client, given a full starting profile so the diff has something to compare. */
const STARTING_PROFILE = { name: 'Seed Client', contact: 'owner@client.test', notes: 'Retainer' };

async function target() {
  const [row] = await db.select().from(clients).where(eq(clients.id, seed.client.id)).limit(1);
  return row;
}

async function auditFor(clientId: string) {
  return db.select().from(auditLog).where(eq(auditLog.resourceId, clientId));
}

/** §9.6 grants client.* to HR and the fixture has no HR user — promote a seeded row. */
async function promoteToHr(userId: string) {
  await db.update(userTable).set({ role: 'admin_hr' }).where(eq(userTable.id, userId));
}

beforeEach(async () => {
  seed = await seedMinimal();
  await db.update(clients).set(STARTING_PROFILE).where(eq(clients.id, seed.client.id));
  setClock(createTestClock(NOW));
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('createClient (§13.2.1)', () => {
  it('inserts the client and audits client.created in the same tx', async () => {
    actAs(seed.superAdmin.id);

    const row = expectOk(await createClient({ name: 'Acme Dental', contact: 'Rahim, 01700000000' }));

    expect(row.id).toMatch(/^cli_/);
    expect(row).toMatchObject({
      name: 'Acme Dental',
      contact: 'Rahim, 01700000000',
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    const audit = await auditFor(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'client.created',
      resourceType: 'client',
      before: null,
    });
    expect(audit[0].after).toMatchObject({ id: row.id, name: 'Acme Dental' });
  });
});

describe('updateClient (§13.2.2)', () => {
  it('writes and audits only the fields that changed; null clears', async () => {
    actAs(seed.superAdmin.id);
    const later = new Date('2026-09-15T05:00:00.000Z');
    setClock(createTestClock(later));

    // `name` posted back unchanged — a real form sends the whole row.
    expectOk(
      await updateClient({
        clientId: seed.client.id,
        name: STARTING_PROFILE.name,
        contact: 'new@client.test',
        notes: null,
      }),
    );

    expect(await target()).toMatchObject({
      name: 'Seed Client',
      contact: 'new@client.test',
      notes: null,
      updatedAt: later,
    });

    const audit = await auditFor(seed.client.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'client.updated', resourceType: 'client' });
    expect(audit[0].before).toEqual({ contact: 'owner@client.test', notes: 'Retainer' });
    expect(audit[0].after).toEqual({ contact: 'new@client.test', notes: null });
  });

  it('is a no-op when nothing changed — no UPDATE, no audit row', async () => {
    actAs(seed.superAdmin.id);

    const before = await target();
    const auditBefore = await db.select().from(auditLog);

    expectOk(await updateClient({ clientId: seed.client.id, ...STARTING_PROFILE }));

    // updated_at untouched proves no UPDATE ran, not merely that the values match.
    expect(await target()).toEqual(before);
    expect(await db.select().from(auditLog)).toHaveLength(auditBefore.length);
  });

  it('rejects clearing name — it is NOT NULL and never nullable here', async () => {
    actAs(seed.superAdmin.id);

    // A ZodError, not an AppError, so it stays a throw (see update-employee.test.ts).
    await expect(
      updateClient({ clientId: seed.client.id, name: null } as unknown as Parameters<
        typeof updateClient
      >[0]),
    ).rejects.toThrow();
    expect((await target()).name).toBe('Seed Client');
  });
});

/**
 * `seedMinimal` now seeds `proj_seed` — an ACTIVE project owned by `seed_client` (PUL-401.4) —
 * so the §13.2.3 `client_in_use` gate is live and `seed_client` no longer archives by default.
 *
 * That is the correct new behaviour, not an obstacle: these cases archive the *project* first,
 * which is what an operator would genuinely have to do. Archiving the project rather than
 * deleting it keeps the case closest to real use.
 */
/** The seed client's account ids (Amendment M: projects reach their client via an account). */
function seedClientAccounts() {
  return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.clientId, seed.client.id));
}

async function releaseSeedClient() {
  await db
    .update(projects)
    .set({ status: 'archived' })
    .where(inArray(projects.accountId, seedClientAccounts()));
}

describe('archiveClient (§13.2.3)', () => {
  it('soft-deletes (sets deleted_at, keeps the row) and audits client.archived', async () => {
    actAs(seed.superAdmin.id);
    await releaseSeedClient();

    expectOk(await archiveClient({ clientId: seed.client.id }));

    const row = await target();
    expect(row).toBeDefined();
    expect(row.deletedAt).toEqual(NOW);
    expect(row.updatedAt).toEqual(NOW);

    const audit = await auditFor(seed.client.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.superAdmin.id,
      action: 'client.archived',
      resourceType: 'client',
      before: { deletedAt: null },
      after: { deletedAt: NOW.toISOString() },
    });

    // Archived drops out of pickers but stays in the admin list.
    expect((await activeClientsQuery()).map((c) => c.id)).not.toContain(seed.client.id);
    expect((await clientsListQuery()).map((c) => c.id)).toContain(seed.client.id);
  });

  it('re-archiving is a no-op with no second audit row', async () => {
    actAs(seed.superAdmin.id);
    await releaseSeedClient();

    expectOk(await archiveClient({ clientId: seed.client.id }));
    expectOk(await archiveClient({ clientId: seed.client.id }));

    expect(await auditFor(seed.client.id)).toHaveLength(1);
  });

  it('blocks with GATE:client_in_use while the client has a live project', async () => {
    // This case previously asserted the OPPOSITE — that the gate was vacuous and the archive
    // succeeded — because `projects` did not exist and `getClientProjectUsage` returned a
    // hard-coded empty list. PUL-401 created the table and PUL-402 Stage 2 filled the query,
    // so the gate now bites and the expectation is corrected to match.
    actAs(seed.superAdmin.id);

    // Called through a real transaction handle, the way archiveClient calls it.
    const usage = await db.transaction((tx) => getClientProjectUsage(tx, seed.client.id));
    expect(usage.liveProjects).toEqual([{ projectId: seed.project.id, name: seed.project.name }]);

    const failure = expectFail(
      await archiveClient({ clientId: seed.client.id }),
      'GATE',
      'client_in_use',
    );
    expect(failure.details).toMatchObject({ projectIds: [seed.project.id] });

    // Blocked means blocked: still live, no audit row.
    expect((await target()).deletedAt).toBeNull();
    expect(await auditFor(seed.client.id)).toHaveLength(0);
  });

  it('archives once the client has only archived projects', async () => {
    actAs(seed.superAdmin.id);
    await releaseSeedClient();

    const usage = await db.transaction((tx) => getClientProjectUsage(tx, seed.client.id));
    expect(usage.liveProjects).toEqual([]);

    expectOk(await archiveClient({ clientId: seed.client.id }));
    expect((await target()).deletedAt).toEqual(NOW);
  });

  it('archives a client that has no projects at all', async () => {
    actAs(seed.superAdmin.id);

    const created = expectOk(await createClient({ name: 'Never Engaged' }));
    expectOk(await archiveClient({ clientId: created.id }));
  });

  it('a soft-deleted project does not block either', async () => {
    actAs(seed.superAdmin.id);

    // Deleted is not merely archived, but neither is "live" — §13.2.3's gate is about work in
    // flight, and a deleted project has none.
    await db
      .update(projects)
      .set({ deletedAt: NOW })
      .where(inArray(projects.accountId, seedClientAccounts()));

    expectOk(await archiveClient({ clientId: seed.client.id }));
  });
});

describe('client authorization (§9.6 ¹⁰)', () => {
  it('allows admin_hr to create, update and archive', async () => {
    await promoteToHr(seed.employees[1].id);
    actAs(seed.employees[1].id);

    const created = expectOk(await createClient({ name: 'HR Created' }));
    expectOk(await updateClient({ clientId: created.id, notes: 'set by HR' }));
    expectOk(await archiveClient({ clientId: created.id }));

    expect(await auditFor(created.id)).toHaveLength(3);
  });

  it('denies a plain employee create / update / archive with FORBIDDEN and writes nothing', async () => {
    actAs(seed.employees[0].id);
    const auditBefore = await db.select().from(auditLog);

    expectFail(await createClient({ name: 'Nope' }), 'FORBIDDEN');
    expectFail(await updateClient({ clientId: seed.client.id, name: 'Nope' }), 'FORBIDDEN');
    expectFail(await archiveClient({ clientId: seed.client.id }), 'FORBIDDEN');

    expect(await target()).toMatchObject({ ...STARTING_PROFILE, deletedAt: null });
    expect(await db.select().from(clients)).toHaveLength(1);
    expect(await db.select().from(auditLog)).toHaveLength(auditBefore.length);
  });

  it('allows a plain employee to read clients', async () => {
    actAs(seed.employees[0].id);

    await expect(authorize('client.read')).resolves.toMatchObject({ id: seed.employees[0].id });
    expect(await activeClientsQuery()).toEqual([{ id: seed.client.id, name: 'Seed Client' }]);
  });
});

describe('unknown client', () => {
  it('returns NOT_FOUND from update and archive', async () => {
    actAs(seed.superAdmin.id);

    expectFail(await updateClient({ clientId: 'cli_does_not_exist', name: 'Ghost' }), 'NOT_FOUND');
    expectFail(await archiveClient({ clientId: 'cli_does_not_exist' }), 'NOT_FOUND');
  });
});
