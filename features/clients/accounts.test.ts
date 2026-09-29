// features/clients/accounts.test.ts
//
// Contract test for the Amendment M account actions: §13.2.4 `createAccount`, §13.2.5
// `updateAccount`, §13.2.6 `archiveAccount` / `unarchiveAccount` (PUL-415), and the amended
// §13.2.3 gate that stops `archiveClient` while the client has live accounts.
//
// Same rig as clients.test.ts: the real easygrowcrm_test database, no DB mocks and no mocked
// `authorize()` (§15.8). The only stub is `auth.api.getSession`; `getSessionUser()` still reads
// `role` and `active` from Postgres, so every authz case is decided by a real row. Time is frozen
// through the clock port.
//
// `seedMinimal` gives `seed_client` one account, `seed_account`, holding one ACTIVE project,
// `proj_seed`. So both gates are closed at the start of every case.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { accounts, auditLog, clients, projects, user as userTable } from '../../db/schema';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { expectFail, expectOk } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { archiveAccount, archiveClient, createAccount, unarchiveAccount, updateAccount } =
  await import('./actions');
const { accountsListQuery, activeAccountsQuery, getAccountProjectUsage, getClientAccountUsage } =
  await import('./queries');

const NOW = new Date('2026-09-29T04:00:00.000Z');

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

async function accountRow(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row;
}

async function auditFor(resourceId: string, action?: string) {
  return db
    .select()
    .from(auditLog)
    .where(
      action
        ? and(eq(auditLog.resourceId, resourceId), eq(auditLog.action, action))
        : eq(auditLog.resourceId, resourceId),
    );
}

/** Close the seed account's only project, which opens the account gate. */
async function archiveSeedProject() {
  await db.update(projects).set({ status: 'archived' }).where(eq(projects.id, seed.project.id));
}

/** §9.6 note 12 grants account.* to HR and the fixture has no HR user: promote a seeded row. */
async function promoteToHr(userId: string) {
  await db.update(userTable).set({ role: 'admin_hr' }).where(eq(userTable.id, userId));
}

beforeEach(async () => {
  seed = await seedMinimal();
  setClock(createTestClock(NOW));
});

afterEach(() => {
  getSession.mockReset();
  resetClock();
});

describe('createAccount (§13.2.4)', () => {
  it('creates the account under its client, on the clock, and audits account.created', async () => {
    actAs(seed.projectManager.id);

    const created = expectOk(
      await createAccount({
        clientId: seed.client.id,
        name: "Joe's Plumbing",
        location: 'Austin, TX',
        website: '   ', // blank optional → stored as NULL, not ""
      }),
    );

    expect(created.id).toMatch(/^acc_/);
    expect(await accountRow(created.id)).toMatchObject({
      clientId: seed.client.id,
      name: "Joe's Plumbing",
      location: 'Austin, TX',
      website: null,
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    const audit = await auditFor(created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      action: 'account.created',
      resourceType: 'account',
      before: null,
    });
    expect(audit[0].after).toMatchObject({ name: "Joe's Plumbing", clientId: seed.client.id });
  });

  it('refuses a missing client and an archived client with NOT_FOUND, writing nothing', async () => {
    actAs(seed.projectManager.id);

    expectFail(await createAccount({ clientId: 'cli_nope', name: 'Ghost' }), 'NOT_FOUND');

    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, seed.client.id));
    expectFail(await createAccount({ clientId: seed.client.id, name: 'Too Late' }), 'NOT_FOUND');

    const names = (await db.select({ name: accounts.name }).from(accounts)).map((r) => r.name);
    expect(names).not.toContain('Ghost');
    expect(names).not.toContain('Too Late');
  });
});

describe('updateAccount (§13.2.5)', () => {
  it('writes and audits only the fields that changed; a blank optional clears', async () => {
    actAs(seed.teamLeader.id);
    await db
      .update(accounts)
      .set({ location: 'Tampa, FL', notes: 'Old note' })
      .where(eq(accounts.id, seed.account.id));

    expectOk(
      await updateAccount({
        accountId: seed.account.id,
        name: seed.account.name, // posted back unchanged
        location: 'Tampa, FL', // unchanged
        notes: '', // cleared
        website: 'https://example.test',
      }),
    );

    expect(await accountRow(seed.account.id)).toMatchObject({
      name: seed.account.name,
      location: 'Tampa, FL',
      notes: null,
      website: 'https://example.test',
      updatedAt: NOW,
    });

    const audit = await auditFor(seed.account.id, 'account.updated');
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toEqual({ notes: 'Old note', website: null });
    expect(audit[0].after).toEqual({ notes: null, website: 'https://example.test' });
  });

  it('is a no-op when nothing changed: no UPDATE, no audit row', async () => {
    actAs(seed.teamLeader.id);
    const before = await accountRow(seed.account.id);

    expectOk(await updateAccount({ accountId: seed.account.id, name: seed.account.name }));

    expect((await accountRow(seed.account.id)).updatedAt).toEqual(before.updatedAt);
    expect(await auditFor(seed.account.id, 'account.updated')).toHaveLength(0);
  });

  it('refuses an unknown account with NOT_FOUND', async () => {
    actAs(seed.teamLeader.id);
    expectFail(await updateAccount({ accountId: 'acc_nope', name: 'X' }), 'NOT_FOUND');
  });
});

describe('archiveAccount (§13.2.6) and GATE:account_in_use', () => {
  it('blocks while the account has a live project, naming it, and writes nothing', async () => {
    actAs(seed.projectManager.id);

    // Read through a real transaction handle, the way archiveAccount calls it.
    const usage = await db.transaction((tx) => getAccountProjectUsage(tx, seed.account.id));
    expect(usage.liveProjects).toEqual([{ projectId: seed.project.id, name: seed.project.name }]);

    const failure = expectFail(
      await archiveAccount({ accountId: seed.account.id }),
      'GATE',
      'account_in_use',
    );
    expect(failure.details).toMatchObject({ projectIds: [seed.project.id] });

    expect((await accountRow(seed.account.id)).deletedAt).toBeNull();
    expect(await auditFor(seed.account.id)).toHaveLength(0);
  });

  it('archives once its projects are archived: soft delete, audit, out of pickers', async () => {
    actAs(seed.projectManager.id);
    await archiveSeedProject();

    expectOk(await archiveAccount({ accountId: seed.account.id }));

    const row = await accountRow(seed.account.id);
    expect(row.deletedAt).toEqual(NOW);
    expect(row.updatedAt).toEqual(NOW);

    const audit = await auditFor(seed.account.id, 'account.archived');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seed.projectManager.id,
      resourceType: 'account',
      before: { deletedAt: null },
      after: { deletedAt: NOW.toISOString() },
    });

    // Out of pickers, still in the admin list.
    expect((await activeAccountsQuery()).map((a) => a.id)).not.toContain(seed.account.id);
    expect((await accountsListQuery()).map((a) => a.id)).toContain(seed.account.id);
  });

  it('a soft-deleted project does not block either', async () => {
    actAs(seed.projectManager.id);
    await db.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, seed.project.id));

    expectOk(await archiveAccount({ accountId: seed.account.id }));
  });

  it('re-archiving is a no-op with no second audit row', async () => {
    actAs(seed.projectManager.id);
    await archiveSeedProject();

    expectOk(await archiveAccount({ accountId: seed.account.id }));
    expectOk(await archiveAccount({ accountId: seed.account.id }));

    expect(await auditFor(seed.account.id, 'account.archived')).toHaveLength(1);
  });
});

describe('unarchiveAccount (§13.2.6)', () => {
  it('restores an archived account and audits account.unarchived', async () => {
    actAs(seed.teamLeader.id);
    const archivedAt = new Date('2026-09-01T00:00:00.000Z');
    await db
      .update(accounts)
      .set({ deletedAt: archivedAt })
      .where(eq(accounts.id, seed.account.id));

    expectOk(await unarchiveAccount({ accountId: seed.account.id }));

    expect((await accountRow(seed.account.id)).deletedAt).toBeNull();
    const audit = await auditFor(seed.account.id, 'account.unarchived');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      before: { deletedAt: archivedAt.toISOString() },
      after: { deletedAt: null },
    });
    expect((await activeAccountsQuery()).map((a) => a.id)).toContain(seed.account.id);
  });

  it('is a no-op on a live account', async () => {
    actAs(seed.teamLeader.id);
    expectOk(await unarchiveAccount({ accountId: seed.account.id }));
    expect(await auditFor(seed.account.id)).toHaveLength(0);
  });

  it('refuses with GATE:client_archived while the client is archived, and writes nothing', async () => {
    actAs(seed.teamLeader.id);
    await db.update(accounts).set({ deletedAt: NOW }).where(eq(accounts.id, seed.account.id));
    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, seed.client.id));

    const failure = expectFail(
      await unarchiveAccount({ accountId: seed.account.id }),
      'GATE',
      'client_archived',
    );
    expect(failure.message).toBe('Unarchive the client first.');

    expect((await accountRow(seed.account.id)).deletedAt).toEqual(NOW);
    expect(await auditFor(seed.account.id, 'account.unarchived')).toHaveLength(0);
  });
});

describe('archiveClient gate on live accounts (§13.2.3 as amended)', () => {
  it('blocks with GATE:client_in_use while an account is live, even with no live project', async () => {
    actAs(seed.superAdmin.id);
    // No live project anywhere: under the old rule this client would now archive.
    await archiveSeedProject();

    const usage = await db.transaction((tx) => getClientAccountUsage(tx, seed.client.id));
    expect(usage.liveAccounts).toEqual([{ accountId: seed.account.id, name: seed.account.name }]);

    const failure = expectFail(
      await archiveClient({ clientId: seed.client.id }),
      'GATE',
      'client_in_use',
    );
    expect(failure.details).toMatchObject({ accountIds: [seed.account.id] });

    const [client] = await db.select().from(clients).where(eq(clients.id, seed.client.id));
    expect(client.deletedAt).toBeNull();
    expect(await auditFor(seed.client.id)).toHaveLength(0);
  });

  it('archives once every account is archived', async () => {
    actAs(seed.superAdmin.id);
    await archiveSeedProject();
    expectOk(await archiveAccount({ accountId: seed.account.id }));

    const usage = await db.transaction((tx) => getClientAccountUsage(tx, seed.client.id));
    expect(usage.liveAccounts).toEqual([]);

    expectOk(await archiveClient({ clientId: seed.client.id }));
    const [client] = await db.select().from(clients).where(eq(clients.id, seed.client.id));
    expect(client.deletedAt).toEqual(NOW);
  });
});

describe('account pickers', () => {
  it('activeAccountsQuery hides accounts of an archived client, even when the account is live', async () => {
    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, seed.client.id));

    expect((await activeAccountsQuery()).map((a) => a.id)).not.toContain(seed.account.id);
    expect((await accountsListQuery()).map((a) => a.id)).toContain(seed.account.id);
  });
});

describe('account authorization (§9.6 note 12)', () => {
  it.each([
    ['super_admin', () => seed.superAdmin.id],
    ['team_leader', () => seed.teamLeader.id],
    ['project_manager', () => seed.projectManager.id],
  ] as const)('allows %s to create an account', async (_role, id) => {
    actAs(id());
    expectOk(await createAccount({ clientId: seed.client.id, name: 'Allowed Co' }));
  });

  it('allows admin_hr to create, update, archive and unarchive', async () => {
    await promoteToHr(seed.employees[1].id);
    actAs(seed.employees[1].id);

    const created = expectOk(await createAccount({ clientId: seed.client.id, name: 'HR Co' }));
    expectOk(await updateAccount({ accountId: created.id, notes: 'Signed' }));
    expectOk(await archiveAccount({ accountId: created.id }));
    expectOk(await unarchiveAccount({ accountId: created.id }));
  });

  it('denies an employee every account write with FORBIDDEN, and writes nothing', async () => {
    actAs(seed.employees[0].id);
    const before = await accountRow(seed.account.id);

    expectFail(await createAccount({ clientId: seed.client.id, name: 'Nope' }), 'FORBIDDEN');
    expectFail(await updateAccount({ accountId: seed.account.id, name: 'Nope' }), 'FORBIDDEN');
    expectFail(await archiveAccount({ accountId: seed.account.id }), 'FORBIDDEN');
    expectFail(await unarchiveAccount({ accountId: seed.account.id }), 'FORBIDDEN');

    expect(await accountRow(seed.account.id)).toEqual(before);
    const names = (await db.select({ name: accounts.name }).from(accounts)).map((r) => r.name);
    expect(names).not.toContain('Nope');
    expect(await auditFor(seed.account.id)).toHaveLength(0);
  });
});
