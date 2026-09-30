// app/(app)/settings/page.tsx: PUL-110.4. Clients moved out to /clients; working hours, policy,
// the Discord webhook and the holidays editor arrive in PUL-903.

import { Placeholder } from '../placeholder';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function SettingsPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/settings');

  return <Placeholder route="/settings" />;
}
