// app/(app)/settings/page.tsx — PUL-110.4, extended by PUL-207 Stage 2

import { ClientsSection } from '@/features/clients/components/clients-section';
import { clientsListQuery } from '@/features/clients/queries';
import { canSeeSettingsSection, PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function SettingsPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  const viewer = await requireRouteAccess('/settings');

  const { title, subtitle } = PAGE_META['/settings'];

  // Section visibility is presentation (lib/nav.ts SETTINGS_SECTIONS); the client actions
  // authorize `client.*` server-side regardless of what renders here.
  const showClients = canSeeSettingsSection(viewer.role, 'clients');

  // Includes archived clients on purpose: the status ▾ needs both sets, and this list is where
  // an archive gets confirmed. Pickers use `activeClientsQuery` instead.
  const clients = showClients ? await clientsListQuery() : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-heading text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>

      {/* Working hours, policy, Discord webhook and the holidays editor arrive in PUL-903. */}

      {showClients ? <ClientsSection clients={clients} /> : null}
    </div>
  );
}
