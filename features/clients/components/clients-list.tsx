// features/clients/components/clients-list.tsx (PUL-207 Stage 2, moved to /clients)
//
// The /clients page body: one row per client (name, contact, Active/Archived, account count), a
// name search and a Show archived toggle. A row expands to that client's accounts
// (`client-accounts.tsx`, Amendment M). Deliberately flat and simple: PUL-417 adds the
// Client › Account › Project tree to the Projects workspace.
//
// Two permission flags arrive from the server page, both computed with `can()`:
//   - `canManageClients` (`client.*`, §9.6: SA, HR) shows + Add Client, Edit and Archive.
//   - `canManageAccounts` (`account.*`, §9.6 ¹²: SA, HR, TL, PM) shows the account controls.
// Controls a viewer cannot use are hidden, not disabled. Presentation only: every action
// re-authorizes on the server (§9.5).
//
// The whole list arrives from the server component and every filter runs in memory: the
// agency has tens of clients, the same reasoning as the PUL-206 employee grid. After any
// successful mutation `router.refresh()` re-runs the page, and the dialogs look their client up
// by id in the fresh array, so nothing shows a stale copy.

'use client';

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
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
import { showErrorToast } from '@/lib/show-error-toast';
import { archiveClient } from '../actions';
import type { AccountRow, ClientRow } from '../queries';
import { ClientAccounts } from './client-accounts';
import { ClientFormBody } from './client-form';

export interface ClientsListPermissions {
  /** `client.create` / `client.update` / `client.archive`: SA and HR. */
  canManageClients: boolean;
  /** `account.create` / `account.update` / `account.archive`: SA, HR, TL and PM. */
  canManageAccounts: boolean;
}

export function ClientsList({
  clients,
  accounts,
  permissions,
}: {
  /** Every client, archived included; the toggle decides what shows. */
  clients: ClientRow[];
  /** Every account, archived included; grouped under their client below. */
  accounts: AccountRow[];
  permissions: ClientsListPermissions;
}) {
  const { canManageClients, canManageAccounts } = permissions;
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (!showArchived && c.deletedAt !== null) return false;
      // Stored name only, never the contact or notes.
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [clients, showArchived, search]);

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

  function toggle(clientId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  // Columns: chevron, name, contact, status, accounts, and actions only for client managers.
  const columnCount = canManageClients ? 6 : 5;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search clients by name"
          className="w-full sm:max-w-56"
        />

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-3.5"
          />
          Show archived
        </label>

        <span className="text-muted-foreground text-xs">
          {visible.length} of {clients.length}
        </span>

        {canManageClients ? (
          <div className="ml-auto">
            <AddClientDialog />
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        // §14.15 r.4: every list gets an empty state with a one-line explanation.
        <Card className="text-muted-foreground p-8 text-center text-sm">
          {clients.length === 0
            ? canManageClients
              ? 'No clients yet. Add the first one to start projects against it.'
              : 'No clients yet. A super admin or HR adds them.'
            : 'No clients match these filters.'}
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="w-8 px-2 py-2">
                  <span className="sr-only">Expand</span>
                </th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Accounts</th>
                {canManageClients ? (
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((client) => {
                const archived = client.deletedAt !== null;
                const clientAccounts = accountsByClient.get(client.id) ?? [];
                const activeAccounts = clientAccounts.filter((a) => a.deletedAt === null).length;
                const open = expanded.has(client.id);
                const bodyId = `client-accounts-${client.id}`;
                return (
                  <Fragment key={client.id}>
                    {/* The row click is a mouse shortcut for the chevron, which is the keyboard
                      path. It expands rather than edits, since not every viewer can edit. */}
                    <tr
                      onClick={() => toggle(client.id)}
                      className="hover:bg-muted/40 cursor-pointer border-b last:border-b-0"
                    >
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => toggle(client.id)}
                          aria-expanded={open}
                          aria-controls={bodyId}
                          aria-label={open ? `Collapse ${client.name}` : `Expand ${client.name}`}
                        >
                          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        </Button>
                      </td>
                      <td className="max-w-48 truncate px-3 py-2 font-medium">{client.name}</td>
                      <td className="text-muted-foreground max-w-48 truncate px-3 py-2">
                        {client.contact?.trim() || 'Not set'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                          {archived ? 'Archived' : 'Active'}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground px-3 py-2">
                        {activeAccounts}
                        {clientAccounts.length > activeAccounts
                          ? ` (+${clientAccounts.length - activeAccounts} archived)`
                          : null}
                      </td>
                      {canManageClients ? (
                        // stopPropagation keeps Edit / Archive from also toggling the row.
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(client.id)}
                            >
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
                      ) : null}
                    </tr>
                    {open ? (
                      <tr id={bodyId} className="border-b last:border-b-0">
                        <td colSpan={columnCount} className="bg-muted/20 px-3 pt-1 pb-2 pl-10">
                          <ClientAccounts
                            client={client}
                            accounts={clientAccounts}
                            canManage={canManageAccounts}
                          />
                        </td>
                      </tr>
                    ) : null}
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
        onOpenChange={(next: boolean) => {
          if (!next) setEditingId(null);
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
        onOpenChange={(next: boolean) => {
          if (!next) setArchivingId(null);
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

export function ArchiveConfirmBody({ client, onDone }: { client: ClientRow; onDone: () => void }) {
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
      // Not optimistic: archive is a confirmed, audited action (§14.15 r.5–6).
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
          listed here under Show archived. A client with active accounts can&apos;t be archived:
          archive its accounts first.
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
