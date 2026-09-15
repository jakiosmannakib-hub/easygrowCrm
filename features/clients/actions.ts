// features/clients/actions.ts
//
// Client administration actions (§13.2). Built to the 5-step shape from
// features/_example/actions.ts: validate → authorize → withTx → writeAudit → notify, inside
// the PUL-111 `actionResult` boundary.
//
// No `unarchiveClient`: §13.2 defines create / update / archive and no reverse, and §13's
// closing note forbids adding actions it does not list. If un-archiving is wanted it needs a
// §13 entry first.

'use server';

import { eq } from 'drizzle-orm';
import { clients } from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { withTx } from '../../lib/mutation';
import { writeAudit } from '../audit/write-audit';
import { getClientProjectUsage } from './queries';
import { ArchiveClientInput, CreateClientInput, UpdateClientInput } from './schema';

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
 * Guard: no non-archived project may reference the client (`GATE:client_in_use`). The usage
 * read runs INSIDE the transaction, on `tx` — see `getClientProjectUsage`. It is vacuous until
 * PUL-401 fills that function's body; nothing here changes when it does.
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

      const usage = await getClientProjectUsage(tx, parsed.clientId);

      if (usage.liveProjects.length > 0) {
        throw new AppError('GATE', 'This client still has live projects', {
          reason: 'client_in_use',
          projectIds: usage.liveProjects.map((p) => p.projectId),
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
