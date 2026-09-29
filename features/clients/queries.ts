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
 * The live projects that block archiving a client (§13.2.3, `GATE:client_in_use`).
 *
 * "Live" is `status='active' AND deleted_at IS NULL`. Archived and soft-deleted projects do
 * NOT block: the whole point of archiving a client is that its finished work stays on file, and
 * a client whose every project is closed is exactly the client you archive. The `projects` FK
 * to `clients` is NOT NULL and archiving is a soft delete, so those historical rows keep naming
 * their client either way.
 *
 * `executor` is the FIRST argument, and `archiveClient` calls it with its `tx`. This is the
 * fix §17.7 #2 prescribes for `getDeactivationBlockers`: the usage check and the `deleted_at`
 * UPDATE must share one snapshot, or a project created against this client in between would be
 * left pointing at an archived client.
 *
 * Since PUL-414 (Amendment M) a project reaches its client through its account, so this joins
 * `accounts` — every account of the client, archived or not, so a live project can never hide
 * behind an archived account. Amendment M moves the gate itself to live *accounts* (PUL-415.2);
 * until then it keeps its §13.2.3 meaning.
 */
export interface ClientProjectUsage {
  liveProjects: Array<{ projectId: string; name: string }>;
}

export async function getClientProjectUsage(
  executor: Executor,
  clientId: string,
): Promise<ClientProjectUsage> {
  const rows = await executor
    .select({ projectId: projects.id, name: projects.name })
    .from(projects)
    .innerJoin(accounts, eq(accounts.id, projects.accountId))
    .where(
      and(
        eq(accounts.clientId, clientId),
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
