// features/clients/actions.ts
//
// Client and account administration actions (§13.2; accounts per Amendment M). Built to the
// 5-step shape from
// features/_example/actions.ts: validate → authorize → withTx → writeAudit → notify, inside
// the PUL-111 `actionResult` boundary.
//
// No `unarchiveClient`: §13.2 defines create / update / archive and no reverse, and §13's
// closing note forbids adding actions it does not list. If un-archiving is wanted it needs a
// §13 entry first.

'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { accounts, clients } from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { withTx } from '../../lib/mutation';
import { writeAudit } from '../audit/write-audit';
import { getAccountProjectUsage, getClientAccountUsage } from './queries';
import {
  ArchiveAccountInput,
  ArchiveClientInput,
  CreateAccountInput,
  CreateClientInput,
  UpdateAccountInput,
  UpdateClientInput,
} from './schema';

/**
 * §13.2.1 `createClient` — SA + HR (`client.create`).
 *
 * Timestamps come from the clock port rather than the column defaults, so `created_at`,
 * `updated_at` and a later `deleted_at` all sit on one timeline under a frozen test clock.
 *
 * Notify: none (§13.2.1).
 */
export async function createClient(input: CreateClientInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateClientInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('client.create');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const id = `cli_${crypto.randomUUID()}`;
      const now = clock.now();

      const [row] = await tx
        .insert(clients)
        .values({
          id,
          name: parsed.name,
          contact: parsed.contact ?? null,
          notes: parsed.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 4. AUDIT — same tx (§9.8 "client create/update/archive").
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'client.created',
        resourceType: 'client',
        resourceId: id,
        before: null,
        after: row,
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.2.1).
  });
}

/** The only columns §13.2.2 may touch. `name` is `NOT NULL`; `contact` and `notes` clear. */
type ClientEdit = {
  name?: string;
  contact?: string | null;
  notes?: string | null;
};
type EditableField = keyof ClientEdit;

/**
 * §13.2.2 `updateClient` — SA + HR (`client.update`).
 *
 * The PUL-203 diff convention, as in `updateEmployee`: the UPDATE and the audit row carry only
 * the fields that actually changed, and a submit that changes nothing writes nothing — no
 * UPDATE, no `updated_at` bump, no audit row.
 *
 * An archived client is still editable: §13.2.2 names no guard, and correcting a contact on a
 * past client is legitimate. Archive state moves only through §13.2.3.
 *
 * Notify: none (§13.2.2).
 */
export async function updateClient(input: UpdateClientInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UpdateClientInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('client.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      // Read inside the tx so the diff is computed against the row we are about to write.
      const [current] = await tx
        .select()
        .from(clients)
        .where(eq(clients.id, parsed.clientId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Client not found');
      }

      const submitted: ClientEdit = {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.contact !== undefined && { contact: parsed.contact }),
        ...(parsed.notes !== undefined && { notes: parsed.notes }),
      };

      const changes: ClientEdit = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const [field, next] of Object.entries(submitted) as [EditableField, string | null][]) {
        const currentValue = current[field] ?? null;
        const nextValue = next ?? null;
        if (currentValue === nextValue) continue; // submitted, but unchanged
        before[field] = currentValue;
        after[field] = nextValue;
        Object.assign(changes, { [field]: nextValue });
      }

      // Nothing actually moved: no UPDATE, no audit row.
      if (Object.keys(changes).length === 0) {
        return current;
      }

      const [row] = await tx
        .update(clients)
        .set({ ...changes, updatedAt: clock.now() })
        .where(eq(clients.id, parsed.clientId))
        .returning();

      // 4. AUDIT — same tx (§9.8). before/after carry only the changed fields.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'client.updated',
        resourceType: 'client',
        resourceId: parsed.clientId,
        before,
        after,
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.2.2).
  });
}

/**
 * §13.2.3 `archiveClient` — SA + HR (`client.archive`).
 *
 * A soft delete: `deleted_at` is set and the row stays, so historical projects keep naming
 * their client and `clientsListQuery` can still show it.
 *
 * Guard: no live ACCOUNT may reference the client (`GATE:client_in_use`, as Amendment M amends
 * §13.2.3; it used to be live projects). The usage read runs INSIDE the transaction, on `tx`,
 * see `getClientAccountUsage`.
 *
 * Archiving an already-archived client is a no-op with no audit row — the audit log records
 * things that happened, and a double-click must not manufacture a second "archived" event.
 *
 * Notify: none (§13.2.3).
 */
export async function archiveClient(input: ArchiveClientInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ArchiveClientInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('client.archive');

    // 3. TRANSACT — the guard and the write share one snapshot.
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: clients.id, deletedAt: clients.deletedAt })
        .from(clients)
        .where(eq(clients.id, parsed.clientId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Client not found');
      }

      if (current.deletedAt) {
        return current;
      }

      const usage = await getClientAccountUsage(tx, parsed.clientId);

      if (usage.liveAccounts.length > 0) {
        throw new AppError('GATE', 'This client still has live accounts', {
          reason: 'client_in_use',
          accountIds: usage.liveAccounts.map((a) => a.accountId),
        });
      }

      const now = clock.now();

      const [row] = await tx
        .update(clients)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(clients.id, parsed.clientId))
        .returning({ id: clients.id, deletedAt: clients.deletedAt });

      // 4. AUDIT — same tx (§9.8 `client.archived`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'client.archived',
        resourceType: 'client',
        resourceId: parsed.clientId,
        before: { deletedAt: null },
        after: { deletedAt: now.toISOString() },
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.2.3).
  });
}

// ── Accounts (Amendment M, §13.2.4 to §13.2.6) ─────────────────────────────────────────────
//
// A client's end businesses. Same conventions as the client actions above: clock-port
// timestamps, the PUL-203 diff on update, soft delete on archive, and a no-op (with no audit
// row) when nothing changes. Who: SA, TL, PM and HR (§9.6 note 12).

/**
 * §13.2.4 `createAccount` — SA, TL, PM, HR (`account.create`).
 *
 * Guard: the client exists and is live (`NOT_FOUND` otherwise), read on `tx` so a client
 * archived in between cannot gain a new account. NOT_FOUND rather than GATE for the archived
 * case, as in the project actions: no picker offers an archived client.
 *
 * Notify: none.
 */
export async function createAccount(input: CreateAccountInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateAccountInput.parse(input);

    // 2. AUTHORIZE — before withTx (§9.5 rule 1).
    const actor = await authorize('account.create');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, parsed.clientId), isNull(clients.deletedAt)))
        .limit(1);

      if (!client) {
        throw new AppError('NOT_FOUND', 'Client not found');
      }

      const id = `acc_${crypto.randomUUID()}`;
      const now = clock.now();

      const [row] = await tx
        .insert(accounts)
        .values({
          id,
          clientId: parsed.clientId,
          name: parsed.name,
          location: parsed.location?.trim() || null,
          website: parsed.website?.trim() || null,
          notes: parsed.notes?.trim() || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 4. AUDIT — same tx (§9.8, Amendment M).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'account.created',
        resourceType: 'account',
        resourceId: id,
        before: null,
        after: row,
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/** The only columns §13.2.5 may touch. `name` is `NOT NULL`; the rest clear. */
type AccountEdit = {
  name?: string;
  location?: string | null;
  website?: string | null;
  notes?: string | null;
};
type AccountEditableField = keyof AccountEdit;

/**
 * §13.2.5 `updateAccount` — SA, TL, PM, HR (`account.update`).
 *
 * The PUL-203 diff: the UPDATE and the audit row carry only what changed, and a submit that
 * changes nothing writes nothing. Moving an account to another client is not supported, so
 * `client_id` is not editable. An archived account is still editable, like an archived client.
 *
 * Notify: none.
 */
export async function updateAccount(input: UpdateAccountInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UpdateAccountInput.parse(input);

    // 2. AUTHORIZE — before withTx (§9.5 rule 1).
    const actor = await authorize('account.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [current] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, parsed.accountId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Account not found');
      }

      const submitted: AccountEdit = {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.location !== undefined && { location: parsed.location }),
        ...(parsed.website !== undefined && { website: parsed.website }),
        ...(parsed.notes !== undefined && { notes: parsed.notes }),
      };

      const changes: AccountEdit = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const [field, next] of Object.entries(submitted) as [
        AccountEditableField,
        string | null,
      ][]) {
        const currentValue = current[field] ?? null;
        // A blank optional is a clear, the same as sending null. `name` is already trimmed.
        const nextValue = field === 'name' ? next : next?.trim() || null;
        if (currentValue === nextValue) continue; // submitted, but unchanged
        before[field] = currentValue;
        after[field] = nextValue;
        Object.assign(changes, { [field]: nextValue });
      }

      // Nothing actually moved: no UPDATE, no audit row.
      if (Object.keys(changes).length === 0) {
        return current;
      }

      const [row] = await tx
        .update(accounts)
        .set({ ...changes, updatedAt: clock.now() })
        .where(eq(accounts.id, parsed.accountId))
        .returning();

      // 4. AUDIT — same tx. before/after carry only the changed fields.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'account.updated',
        resourceType: 'account',
        resourceId: parsed.accountId,
        before,
        after,
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.2.6 `archiveAccount` — SA, TL, PM, HR (`account.archive`).
 *
 * A soft delete: `deleted_at` is set and the row stays, so finished projects keep naming their
 * account. Guard: no live project may reference it (`GATE:account_in_use`), read on `tx` so a
 * project started in between cannot be stranded on an archived account.
 *
 * Re-archiving is a no-op with no audit row.
 *
 * Notify: none.
 */
export async function archiveAccount(input: ArchiveAccountInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ArchiveAccountInput.parse(input);

    // 2. AUTHORIZE — before withTx (§9.5 rule 1).
    const actor = await authorize('account.archive');

    // 3. TRANSACT — the guard and the write share one snapshot.
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: accounts.id, deletedAt: accounts.deletedAt })
        .from(accounts)
        .where(eq(accounts.id, parsed.accountId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Account not found');
      }

      if (current.deletedAt) {
        return current;
      }

      const usage = await getAccountProjectUsage(tx, parsed.accountId);

      if (usage.liveProjects.length > 0) {
        throw new AppError('GATE', 'This account still has live projects', {
          reason: 'account_in_use',
          projectIds: usage.liveProjects.map((p) => p.projectId),
        });
      }

      const now = clock.now();

      const [row] = await tx
        .update(accounts)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(accounts.id, parsed.accountId))
        .returning({ id: accounts.id, deletedAt: accounts.deletedAt });

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'account.archived',
        resourceType: 'account',
        resourceId: parsed.accountId,
        before: { deletedAt: null },
        after: { deletedAt: now.toISOString() },
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}

/**
 * §13.2.6 `unarchiveAccount` — SA, TL, PM, HR (`account.archive`, the same actors).
 *
 * Guard: the account's client is live, else `GATE:client_archived` ("Unarchive the client
 * first."). A GATE, not NOT_FOUND: the account exists and the fix is one step away, so the refusal
 * should say which step. A live account under an archived client would be offered by no picker
 * and would quietly undo part of the client's archive.
 *
 * Un-archiving a live account is a no-op with no audit row.
 *
 * Notify: none.
 */
export async function unarchiveAccount(input: ArchiveAccountInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ArchiveAccountInput.parse(input);

    // 2. AUTHORIZE — before withTx (§9.5 rule 1).
    const actor = await authorize('account.archive');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({
          id: accounts.id,
          deletedAt: accounts.deletedAt,
          clientDeletedAt: clients.deletedAt,
        })
        .from(accounts)
        .innerJoin(clients, eq(clients.id, accounts.clientId))
        .where(eq(accounts.id, parsed.accountId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Account not found');
      }

      if (!current.deletedAt) {
        return { id: current.id, deletedAt: current.deletedAt };
      }

      if (current.clientDeletedAt) {
        throw new AppError('GATE', 'Unarchive the client first.', { reason: 'client_archived' });
      }

      const [row] = await tx
        .update(accounts)
        .set({ deletedAt: null, updatedAt: clock.now() })
        .where(eq(accounts.id, parsed.accountId))
        .returning({ id: accounts.id, deletedAt: accounts.deletedAt });

      // 4. AUDIT — same tx.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'account.unarchived',
        resourceType: 'account',
        resourceId: parsed.accountId,
        before: { deletedAt: current.deletedAt.toISOString() },
        after: { deletedAt: null },
      });

      return row;
    });

    // 5. NOTIFY — none.
  });
}
