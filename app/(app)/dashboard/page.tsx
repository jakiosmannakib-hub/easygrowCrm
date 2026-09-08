// app/(app)/dashboard/page.tsx — PUL-110.4

import { Placeholder } from '../placeholder';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function DashboardPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/dashboard');

  return <Placeholder route="/dashboard" />;
}
