// features/clients/components/client-accounts.tsx — PUL-415 Stage 2, Amendment M
//
// /clients: the accounts (a client's end businesses) listed under an expanded client row, with
// Add / Edit / Archive / Unarchive through the real §13.2.4 to §13.2.6 actions.
//
// The controls follow `account.*` (§9.6 ¹²: SA, HR, TL, PM) through `canManage`, computed with
// `can()` on the server page. Hidden rather than disabled, and presentation only: every action
// re-authorizes. PUL-417 adds account management to the Projects workspace tree as well.
//
// Same conventions as the client dialogs next door: bodies are mounted only while open and
// keyed by the row, so MOUNTING IS THE RESET; after a successful write `router.refresh()`
// re-reads the page and the dialogs find their row by id in the fresh array. Nothing is
// optimistic: archive is a confirmed, audited action (§14.15 r.5–6). Refusals, including
// `GATE:account_in_use`, go through `showErrorToast`.

'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showErrorToast } from '@/lib/show-error-toast';
import { archiveAccount, createAccount, unarchiveAccount, updateAccount } from '../actions';
import type { AccountRow, ClientRow } from '../queries';
import { CreateAccountInput, UpdateAccountInput } from '../schema';

/** Which dialog is open: add, edit one account, or confirm archiving one. */
type Open = { kind: 'add' } | { kind: 'edit'; id: string } | { kind: 'archive'; id: string } | null;

export function ClientAccounts({
  client,
  accounts,
  canManage,
}: {
  client: ClientRow;
  /** This client's accounts, archived included. */
  accounts: AccountRow[];
  /** `account.create` / `update` / `archive` (§9.6 ¹²). False hides every control. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const clientArchived = client.deletedAt !== null;

  // Resolved against the current (possibly refreshed) array; a vanished row closes its dialog.
  const target = useMemo(
    () => (open && open.kind !== 'add' ? (accounts.find((a) => a.id === open.id) ?? null) : null),
    [accounts, open],
  );

  async function onUnarchive(account: AccountRow) {
    setPendingId(account.id);
    try {
      const result = await unarchiveAccount({ accountId: account.id });
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`${account.name} restored.`);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          Accounts ({accounts.filter((a) => a.deletedAt === null).length} active)
        </span>
        {/* createAccount refuses an archived client, so the button is not offered for one. */}
        {!canManage || clientArchived ? null : (
          <Button size="xs" variant="ghost" onClick={() => setOpen({ kind: 'add' })}>
            + Add account
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No accounts yet. Add the businesses this client resells to.
        </p>
      ) : (
        <ul className="grid gap-1">
          {accounts.map((account) => {
            const archived = account.deletedAt !== null;
            return (
              <li
                key={account.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-xs"
              >
                <span className="font-medium">{account.name}</span>
                {account.location ? (
                  <span className="text-muted-foreground">{account.location}</span>
                ) : null}
                <Badge variant={archived ? 'outline' : 'secondary'}>
                  {archived ? 'Archived' : 'Active'}
                </Badge>
                {canManage ? (
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setOpen({ kind: 'edit', id: account.id })}
                    >
                      Edit
                    </Button>
                    {archived ? (
                      // Refused (GATE:client_archived) while the client is archived; not offered then.
                      clientArchived ? null : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pendingId === account.id}
                          onClick={() => onUnarchive(account)}
                        >
                          {pendingId === account.id ? 'Restoring…' : 'Unarchive'}
                        </Button>
                      )
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setOpen({ kind: 'archive', id: account.id })}
                      >
                        Archive…
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Controlled, no Trigger: opened by state. Each body mounts only while open. */}
      <Dialog
        open={open !== null && (open.kind === 'add' || target !== null)}
        onOpenChange={(next: boolean) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {open?.kind === 'add' ? (
            <AccountFormBody client={client} account={null} onDone={() => setOpen(null)} />
          ) : null}
          {open?.kind === 'edit' && target ? (
            <AccountFormBody
              key={target.id}
              client={client}
              account={target}
              onDone={() => setOpen(null)}
            />
          ) : null}
          {open?.kind === 'archive' && target ? (
            <ArchiveAccountBody key={target.id} account={target} onDone={() => setOpen(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add / edit ──────────────────────────────────────────────────────────────────────────

type FormState = { name: string; location: string; website: string; notes: string };

const EMPTY: FormState = { name: '', location: '', website: '', notes: '' };

function formFor(account: AccountRow): FormState {
  return {
    name: account.name,
    location: account.location ?? '',
    website: account.website ?? '',
    notes: account.notes ?? '',
  };
}

/**
 * The §13.2.5 payload for what the user actually touched (the PUL-203 convention, as the client
 * form's `buildPatch`): absent is "leave alone", `null` is "clear", name is never nulled.
 * `null` when nothing moved.
 */
function buildPatch(form: FormState, account: AccountRow) {
  const patch: Record<string, string | null> = {};

  const name = form.name.trim();
  if (name !== account.name) patch.name = name;

  for (const field of ['location', 'website', 'notes'] as const) {
    const next = form[field].trim() || null;
    if (next !== (account[field] ?? null)) patch[field] = next;
  }

  return Object.keys(patch).length === 0 ? null : { accountId: account.id, ...patch };
}

function AccountFormBody({
  client,
  account,
  onDone,
}: {
  client: ClientRow;
  /** `null` = add a new account to `client`; a row = edit it. */
  account: AccountRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => (account ? formFor(account) : EMPTY));
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = useMemo(() => (account ? buildPatch(form, account) : null), [form, account]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // The same schemas the actions parse: a convenience, not the gate (§9.5 r.2).
    const parsed = account
      ? UpdateAccountInput.safeParse(patch)
      : CreateAccountInput.safeParse({
          clientId: client.id,
          name: form.name,
          location: form.location.trim() || undefined,
          website: form.website.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });

    if (account && !patch) {
      toast.info('No changes to save.');
      return;
    }
    if (!parsed.success) {
      setNameError('Give the account a name.');
      return;
    }

    setNameError(null);
    setSaving(true);
    try {
      const result = account
        ? await updateAccount(parsed.data as UpdateAccountInput)
        : await createAccount(parsed.data as CreateAccountInput);
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(account ? `${result.data.name} saved.` : `${result.data.name} added.`);
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const idPrefix = account ? `account-${account.id}` : `account-new-${client.id}`;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {account ? `Edit ${account.name}` : `Add account to ${client.name}`}
        </DialogTitle>
        <DialogDescription>
          An account is one business {client.name} resells to. Its projects live under it.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Joe's Plumbing"
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            autoFocus
          />
          {nameError ? <p className="text-destructive text-xs">{nameError}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-location`}>Location</Label>
          <Input
            id={`${idPrefix}-location`}
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Optional, e.g. Austin, TX"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-website`}>Website</Label>
          <Input
            id={`${idPrefix}-website`}
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
          <Input
            id={`${idPrefix}-notes`}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </div>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button">
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={saving || (account !== null && !patch)}>
          {saving ? 'Saving…' : account ? 'Save changes' : 'Add account'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Archive confirm ─────────────────────────────────────────────────────────────────────

function ArchiveAccountBody({ account, onDone }: { account: AccountRow; onDone: () => void }) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  async function onConfirm() {
    setArchiving(true);
    try {
      const result = await archiveAccount({ accountId: account.id });
      if (!result.ok) {
        // GATE:account_in_use (live projects) is named by the error-toast mapper.
        showErrorToast(result);
        return;
      }
      toast.success(`${account.name} archived.`);
      router.refresh();
      onDone();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive {account.name}?</DialogTitle>
        <DialogDescription>
          It stops appearing in account pickers. The record and its finished projects are kept, and
          you can unarchive it later. An account with live projects can&apos;t be archived.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button" disabled={archiving}>
              Cancel
            </Button>
          }
        />
        <Button onClick={onConfirm} disabled={archiving}>
          {archiving ? 'Archiving…' : 'Archive account'}
        </Button>
      </DialogFooter>
    </>
  );
}
