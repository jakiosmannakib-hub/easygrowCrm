// features/clients/schema.ts
//
// Input schemas for the clients slice, kept OUT of actions.ts for the same reason as
// features/employees/schema.ts: a 'use server' file may only export async functions, and the
// Stage 2 form reuses these for inline validation. The action still re-parses as the real gate.

import { z } from 'zod';

/** §13.2.1 input. `contact` and `notes` are free text (§11.2); only `name` is required. */
export const CreateClientInput = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateClientInput = z.infer<typeof CreateClientInput>;

/**
 * §13.2.2 input — the PUL-203 diff convention: an absent key is "leave alone", `null` is
 * "clear". `name` is `NOT NULL`, so it can be changed but never cleared; `contact` and `notes`
 * are nullable. A payload with no editable field is a caller bug, not a no-op request.
 */
export const UpdateClientInput = z
  .object({
    clientId: z.string().min(1),
    name: z.string().min(1).optional(),
    contact: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.contact !== undefined || v.notes !== undefined, {
    message: 'Provide at least one field to update',
  });

export type UpdateClientInput = z.infer<typeof UpdateClientInput>;

/** §13.2.3 input. */
export const ArchiveClientInput = z.object({
  clientId: z.string().min(1),
});

export type ArchiveClientInput = z.infer<typeof ArchiveClientInput>;

// ── Accounts (Amendment M, §13.2.4 to §13.2.6) ─────────────────────────────────────────────
// A client's end businesses. Same conventions as the client inputs above.

/** §13.2.4 input. Only `name` is required; `location`, `website` and `notes` are free text. */
export const CreateAccountInput = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1),
  location: z.string().optional(),
  website: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateAccountInput = z.infer<typeof CreateAccountInput>;

/**
 * §13.2.5 input, the PUL-203 diff convention: absent is "leave alone", `null` is "clear".
 * `name` can change but never clear. There is no `clientId`: §13.2.5 does not support moving an
 * account to another client.
 */
export const UpdateAccountInput = z
  .object({
    accountId: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    location: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.location !== undefined ||
      v.website !== undefined ||
      v.notes !== undefined,
    { message: 'Provide at least one field to update' },
  );

export type UpdateAccountInput = z.infer<typeof UpdateAccountInput>;

/** §13.2.6 input, shared by `archiveAccount` and `unarchiveAccount`. */
export const ArchiveAccountInput = z.object({
  accountId: z.string().min(1),
});

export type ArchiveAccountInput = z.infer<typeof ArchiveAccountInput>;
