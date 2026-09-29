// features/clients/components/clients-section.tsx — PUL-207 Stage 2, §14.14 / §13.2
//
// Settings → Clients: the list (name, contact, notes, Active/Archived), status + name filters,
// "+ Add Client", edit, and archive with a confirm step (§14.15 r.6). Since PUL-415 each client
// row is followed by its accounts (Amendment M, `client-accounts.tsx`).
//
// The whole list arrives from the server component and every filter runs in memory — the
// agency has tens of clients, the same reasoning as the PUL-206 employee grid. After any
// successful mutation `router.refresh()` re-runs the page, and the dialogs look their client
// up by id in the fresh array, so nothing shows a stale copy.

'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showErrorToast } from '@/lib/show-error-toast';
import { archiveClient } from '../actions';
import type { AccountRow, ClientRow } from '../queries';
import { ClientAccounts } from './client-accounts';
import { ClientFormBody } from './client-form';

/**
 * Status ▾, defaulting to Active: the everyday question is "who do we work for". Archived
 * clients stay one click away. A fixed list, so it is never narrowed by the other filters.
 */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All statuses' },
] as const;

type Status = (typeof STATUS_OPTIONS)[number]['value'];

export function ClientsSection({
  clients,
  accounts,
}: {
  clients: ClientRow[];
  /** Every account, archived included; grouped under their client below. */
  accounts: AccountRow[];
}) {
  const [status, setStatus] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients.filter((c) => {
      const archived = c.deletedAt !== null;
      if (status === 'active' && archived) return false;
      if (status === 'archived' && !archived) return false;
      // Stored name only — never the pill text, contact or notes.
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [clients, status, search]);

  const accountsByClient = useMemo(() => {
    const byClient = new Map<string, AccountRow[]>();
    for (const account of accounts) {
      const list = byClient.get(account.clientId) ?? [];
      list.push(account);
      byClient.set(account.clientId, list);
    }
    return byClient;
  }, [accounts]);

  // Resolved against the current (possibly refreshed) array; a vanished row closes its dialog.
  const editing = useMemo(
    () => clients.find((c) => c.id === editingId) ?? null,
    [clients, editingId],
  );
  const archiving = useMemo(
    () => clients.find((c) => c.id === archivingId && c.deletedAt === null) ?? null,
    [clients, archivingId],
  );

  return (
    <section className="space-y-4" aria-labelledby="settings-clients-heading">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 id="settings-clients-heading" className="font-heading text-base">
            Clients
          </h3>
          <p className="text-muted-foreground text-sm">
            Everyone can pick a client; only super admins and HR manage the list.
          </p>
        </div>
        <AddClientDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search clients by name"
          className="w-full sm:max-w-56"
        />

        <Select
          value={status}
          onValueChange={(value: string | null) => setStatus((value as Status) ?? 'active')}
        >
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-auto text-xs">
          {visible.length} of {clients.length}
        </span>
      </div>

      {visible.length === 0 ? (
        // §14.15 r.4 — every list gets an empty state with a one-line explanation.
        <Card className="text-muted-foreground p-8 text-center text-sm">
          {clients.length === 0
            ? 'No clients yet. Add the first one to start projects against it.'
            : 'No clients match these filters.'}
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((client) => {
                const archived = client.deletedAt !== null;
                return (
                  <Fragment key={client.id}>
                    <tr
                      onClick={() => setEditingId(client.id)}
                      className="hover:bg-muted/40 cursor-pointer"
                    >
                      <td className="max-w-48 truncate px-3 py-2 font-medium">{client.name}</td>
                      <td className="text-muted-foreground max-w-48 truncate px-3 py-2">
                        {client.contact?.trim() || '—'}
                      </td>
                      <td
                        className="text-muted-foreground max-w-64 truncate px-3 py-2"
                        title={client.notes ?? undefined}
                      >
                        {client.notes?.trim() || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                          {archived ? 'Archived' : 'Active'}
                        </Badge>
                      </td>
                      {/* The buttons are the keyboard path to edit / archive; the row click is a
                        mouse shortcut. stopPropagation keeps Archive from also opening Edit. */}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(client.id)}>
                            Edit
                          </Button>
                          {archived ? null : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setArchivingId(client.id)}
                            >
                              Archive…
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* The client's accounts (Amendment M). Its own row, so clicks here never
                      open the client's Edit dialog. */}
                    <tr className="border-b last:border-b-0">
                      <td colSpan={5} className="bg-muted/20 px-3 pt-1 pb-2 pl-6">
                        <ClientAccounts
                          client={client}
                          accounts={accountsByClient.get(client.id) ?? []}
                        />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Controlled, no Trigger: opened by row state. The body mounts only while open. */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {editing ? (
            <ClientFormBody key={editing.id} client={editing} onDone={() => setEditingId(null)} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={archiving !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setArchivingId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {archiving ? (
            <ArchiveConfirmBody
              key={archiving.id}
              client={archiving}
              onDone={() => setArchivingId(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddClientDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ Add Client</Button>} />
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so every "+ Add Client" starts from an empty form. */}
        {open ? <ClientFormBody client={null} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ArchiveConfirmBody({ client, onDone }: { client: ClientRow; onDone: () => void }) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  async function onConfirm() {
    setArchiving(true);
    try {
      const result = await archiveClient({ clientId: client.id });
      if (!result.ok) {
        // GATE:client_in_use (live accounts, Amendment M) lands here as data and is named by the
        // PUL-106 mapper.
        showErrorToast(result);
        return;
      }
      // Not optimistic — archive is a confirmed, audited action (§14.15 r.5–6).
      toast.success(`${client.name} archived.`);
      router.refresh();
      onDone();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive {client.name}?</DialogTitle>
        <DialogDescription>
          It stops appearing in client pickers. The record and its history are kept, and it stays
          listed here under Archived. A client with active accounts can&apos;t be archived: archive
          its accounts first.
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
          {archiving ? 'Archiving…' : 'Archive client'}
        </Button>
      </DialogFooter>
    </>
  );
}
