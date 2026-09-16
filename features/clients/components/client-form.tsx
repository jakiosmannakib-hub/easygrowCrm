// features/clients/components/client-form.tsx — PUL-207 Stage 2, §14.14
//
// The one form body behind both "+ Add Client" (§13.2.1) and Edit (§13.2.2). It is only ever
// rendered while its dialog is open, and keyed by the client being edited, so MOUNTING IS THE
// RESET: state is seeded at mount and never has to be cleared on close. That also sidesteps the
// Base UI trap where a controlled dialog with no Trigger never reports `onOpenChange` on the
// way in (see features/employees/components/offboarding-dialog.tsx).

'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showErrorToast } from '@/lib/show-error-toast';
import { createClient, updateClient } from '../actions';
import type { ClientRow } from '../queries';
import { CreateClientInput, UpdateClientInput } from '../schema';

/** All strings, because that is what inputs give back; `buildPatch` does the wire conversion. */
type FormState = { name: string; contact: string; notes: string };

const EMPTY: FormState = { name: '', contact: '', notes: '' };

function formFor(client: ClientRow): FormState {
  return { name: client.name, contact: client.contact ?? '', notes: client.notes ?? '' };
}

/**
 * The §13.2.2 payload for what the user actually touched — the PUL-203 convention, mirroring
 * the employee drawer's `buildPatch`:
 *   - an **absent** key means "leave alone", so an untouched field is omitted rather than
 *     resent, and never lands in the audit diff;
 *   - **`null`** means "clear it" — an emptied contact or notes;
 *   - **name is required** and never nulled; an empty name is a validation error.
 *
 * Returns `null` when nothing moved, and the caller skips the round trip.
 */
function buildPatch(form: FormState, client: ClientRow) {
  const patch: Record<string, string | null> = {};

  const name = form.name.trim();
  if (name !== client.name) patch.name = name;

  const contact = form.contact.trim() || null;
  if (contact !== (client.contact ?? null)) patch.contact = contact;

  const notes = form.notes.trim() || null;
  if (notes !== (client.notes ?? null)) patch.notes = notes;

  return Object.keys(patch).length === 0 ? null : { clientId: client.id, ...patch };
}

/** Zod issues → first message per field, for inline errors. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const next: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    next[field] ??= issue.message;
  }
  return next;
}

export function ClientFormBody({
  client,
  onDone,
}: {
  /** `null` = add a new client; a row = edit that client. */
  client: ClientRow | null;
  /** Called after a successful save, to close the dialog. */
  onDone: () => void;
}) {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() => (client ? formFor(client) : EMPTY));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const patch = useMemo(() => (client ? buildPatch(form, client) : null), [form, client]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (client) await save(client);
    else await add();
  }

  async function add() {
    // Blank optionals are omitted, not sent as "" — `.optional()` means absent.
    const input = {
      name: form.name.trim(),
      contact: form.contact.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };

    // The same schema the action parses — a convenience, not the gate (§9.5 r.2).
    const parsed = CreateClientInput.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const result = await createClient(parsed.data);
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`${parsed.data.name} added.`);
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function save(current: ClientRow) {
    if (!patch) {
      toast.info('No changes to save.');
      return;
    }

    const parsed = UpdateClientInput.safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const result = await updateClient(parsed.data);
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`${parsed.data.name ?? current.name} saved.`);
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const idPrefix = client ? `client-${client.id}` : 'client-new';

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{client ? `Edit ${client.name}` : 'Add client'}</DialogTitle>
        <DialogDescription>
          {client
            ? 'Only the fields you change are saved.'
            : 'Everyone can pick this client once it exists. Only admins can change it.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <Field id={`${idPrefix}-name`} label="Name" error={errors.name}>
          <Input
            id={`${idPrefix}-name`}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="off"
          />
        </Field>

        <Field id={`${idPrefix}-contact`} label="Contact" error={errors.contact}>
          <Input
            id={`${idPrefix}-contact`}
            value={form.contact}
            onChange={(e) => set('contact', e.target.value)}
            placeholder="Optional — person, email or phone"
            autoComplete="off"
          />
        </Field>

        <Field id={`${idPrefix}-notes`} label="Notes" error={errors.notes}>
          {/* No textarea primitive in components/ui; a native one styled like Input. */}
          <textarea
            id={`${idPrefix}-notes`}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional"
            rows={3}
            className="border-input bg-input/20 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-input/30 w-full min-w-0 resize-y rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2 md:text-xs/relaxed"
          />
        </Field>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button">
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={saving || (client !== null && !patch)}>
          {saving ? 'Saving…' : client ? 'Save changes' : 'Add client'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
