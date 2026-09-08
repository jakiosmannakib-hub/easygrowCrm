// app/(app)/templates/page.tsx — PUL-110.4

import { Placeholder } from '../placeholder';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function TemplatesPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/templates');

  return <Placeholder route="/templates" />;
}
