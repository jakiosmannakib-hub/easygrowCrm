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
