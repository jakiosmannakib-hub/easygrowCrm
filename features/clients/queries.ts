// features/clients/queries.ts
//
// Reads for the clients slice. No 'use server' and no writes — queries may run anywhere; only
// actions.ts writes (CLAUDE.md §2).
//
// `client.read` is open to every role (§9.6 ¹⁰), so these carry no per-row filtering. As with
// the employees queries, the permission check lives at the call site (route guard / the
// consuming action), not inside the read.

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { accounts, clients, projects } from '../../db/schema';
import type { Executor } from '../../lib/mutation';

/**
 * The live accounts that block archiving a client (§13.2.3 as amended by Amendment M,
 * `GATE:client_in_use`).
 *
 * "Live" is `deleted_at IS NULL`. An archived account does NOT block: archiving a client is for
 * a partner whose every end business is closed, and those accounts stay on file. Projects are
 * not read here at all: an account with a live project cannot be archived (`getAccountProjectUsage`),
 * so "no live accounts" already implies "no live projects".
 *
 * `executor` is the FIRST argument, and `archiveClient` calls it with its `tx` (the §17.7 #2
 * fix): the usage check and the `deleted_at` UPDATE share one snapshot, so an account created
 * against this client in between cannot be left pointing at an archived client.
 */
export interface ClientAccountUsage {
  liveAccounts: Array<{ accountId: string; name: string }>;
}

export async function getClientAccountUsage(
  executor: Executor,
  clientId: string,
): Promise<ClientAccountUsage> {
  const rows = await executor
    .select({ accountId: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), isNull(accounts.deletedAt)))
    .orderBy(asc(accounts.name));

  return { liveAccounts: rows };
}

/**
 * The live projects that block archiving an account (§13.2.6, `GATE:account_in_use`).
 *
 * "Live" is `status='active' AND deleted_at IS NULL`, the meaning §13.2.3 always gave it for
 * clients: archived and soft-deleted projects are finished work and do not block.
 *
 * Executor first, called with `archiveAccount`'s `tx`, for the same reason as above.
 */
export interface AccountProjectUsage {
  liveProjects: Array<{ projectId: string; name: string }>;
}

export async function getAccountProjectUsage(
  executor: Executor,
  accountId: string,
): Promise<AccountProjectUsage> {
  const rows = await executor
    .select({ projectId: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.accountId, accountId),
        eq(projects.status, 'active'),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(asc(projects.name));

  return { liveProjects: rows };
}

/** The columns a client picker needs. */
export interface PickableClient {
  id: string;
  name: string;
}

/**
 * Every **non-archived** client, name-ordered — the source for every client picker (§13.8
 * `getClients`: the filter bar, the Start Project wizard, a daily-plan row).
 *
 * The archived filter lives here, not in each caller, for the same reason `activeUsersQuery`
 * filters `active`: one forgotten `WHERE deleted_at IS NULL` is a new project silently attached
 * to a client the agency no longer works with.
 */
export async function activeClientsQuery(): Promise<PickableClient[]> {
  return db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(asc(clients.name));
}

/** The columns the Settings → Clients list and its edit form need. */
export interface ClientRow {
  id: string;
  name: string;
  contact: string | null;
  notes: string | null;
  deletedAt: Date | null;
}

/**
 * Every client — **including archived ones** — name-ordered, for the Settings admin list
 * (§14.14). The deliberate opposite of `activeClientsQuery()`, mirroring the
 * `employeesListQuery` / `activeUsersQuery` split: a picker offering an archived client is a
 * bug, and an admin list hiding them is also a bug, because it is where SA/HR confirm an archive
 * took. The agency has tens of clients, so no pagination.
 */
export async function clientsListQuery(): Promise<ClientRow[]> {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      contact: clients.contact,
      notes: clients.notes,
      deletedAt: clients.deletedAt,
    })
    .from(clients)
    .orderBy(asc(clients.name));
}

/** The columns the Settings → Clients account rows and the account form need. */
export interface AccountRow {
  id: string;
  clientId: string;
  name: string;
  location: string | null;
  website: string | null;
  notes: string | null;
  deletedAt: Date | null;
}

/**
 * Every account, **including archived ones**, name-ordered, for the Settings admin list
 * (Amendment M). The admin-list half of the `clientsListQuery` / `activeClientsQuery` split: it
 * is where an archive is confirmed, so it must show archived rows. Tens of rows, no pagination.
 */
export async function accountsListQuery(): Promise<AccountRow[]> {
  return db
    .select({
      id: accounts.id,
      clientId: accounts.clientId,
      name: accounts.name,
      location: accounts.location,
      website: accounts.website,
      notes: accounts.notes,
      deletedAt: accounts.deletedAt,
    })
    .from(accounts)
    .orderBy(asc(accounts.name), asc(accounts.id));
}

/** The columns an account picker needs. `clientId` is what the picker filters on. */
export interface PickableAccount {
  id: string;
  clientId: string;
  name: string;
}

/**
 * Every **live** account of a **live** client, name-ordered: the source for every account picker
 * (the Start Project wizard's Account ▾). Both filters live here, not in callers, for the reason
 * `activeClientsQuery` gives: one forgotten predicate is a new project silently attached to a
 * business the agency no longer works for.
 */
export async function activeAccountsQuery(): Promise<PickableAccount[]> {
  return db
    .select({ id: accounts.id, clientId: accounts.clientId, name: accounts.name })
    .from(accounts)
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(and(isNull(accounts.deletedAt), isNull(clients.deletedAt)))
    .orderBy(asc(accounts.name), asc(accounts.id));
}
