// app/(app)/placeholder.tsx — PUL-110.4
//
// Shared body for the 13 placeholder pages. Real content is each feature's Phase 2 ticket;
// this exists so the shell, the nav and the route guards can be exercised end to end now.

import { PAGE_META, type AppRoute } from '@/lib/nav';

export function Placeholder({ route }: { route: AppRoute }) {
  const { title, subtitle } = PAGE_META[route];

  return (
    <div className="space-y-1">
      <h2 className="font-heading text-lg">{title}</h2>
      <p className="text-muted-foreground text-sm">{subtitle}</p>
      <p className="text-muted-foreground pt-4 text-sm">Coming soon.</p>
    </div>
  );
}
