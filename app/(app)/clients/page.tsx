// app/(app)/clients/page.tsx: Clients, moved out of Settings into its own page.

import { ClientsList } from '@/features/clients/components/clients-list';
import { accountsListQuery, clientsListQuery } from '@/features/clients/queries';
import { can } from '@/lib/authz';
import { PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function ClientsPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. /clients is
  // SA, HR, TL and PM (lib/nav.ts), so an employee gets the same 404 as every other guarded
  // page. The two list queries do not authorize themselves; this guard is their call-site check.
  const viewer = await requireRouteAccess('/clients');

  const { title, subtitle } = PAGE_META['/clients'];

  // Includes archived clients and accounts on purpose: the Show archived toggle needs both sets,
  // and this list is where an archive is confirmed and undone. Pickers use the `active*` queries.
  const [clients, accounts] = await Promise.all([clientsListQuery(), accountsListQuery()]);

  // Which controls render (§9.6): hidden, not disabled. Presentation only; every client and
  // account action re-authorizes. §9.6 grants create, update and archive to the same roles for
  // each resource (client: SA, HR; account: SA, HR, TL, PM), so one flag per resource. It
  // requires all three cells, so if they ever diverge the controls hide rather than over-offer.
  const permissions = {
    canManageClients:
      can(viewer, 'client.create') && can(viewer, 'client.update') && can(viewer, 'client.archive'),
    canManageAccounts:
      can(viewer, 'account.create') &&
      can(viewer, 'account.update') &&
      can(viewer, 'account.archive'),
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-heading text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>

      <ClientsList clients={clients} accounts={accounts} permissions={permissions} />
    </div>
  );
}
