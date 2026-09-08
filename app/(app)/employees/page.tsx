// app/(app)/employees/page.tsx — PUL-110.4, extended by PUL-202.3

import { AddEmployeeDialog } from '@/features/employees/components/add-employee-dialog';
import { PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function EmployeesPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/employees');

  const { title, subtitle } = PAGE_META['/employees'];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <AddEmployeeDialog />
      </div>

      {/* PUL-206 replaces this with the card grid + dept/status/search filters (§14.12). */}
      <p className="text-muted-foreground text-sm">Employee list coming soon.</p>
    </div>
  );
}
