// app/(app)/employees/page.tsx — PUL-110.4, extended by PUL-202.3 and PUL-206.1/206.2

import { AddEmployeeDialog } from '@/features/employees/components/add-employee-dialog';
import { EmployeesGrid } from '@/features/employees/components/employees-grid';
import { employeesListQuery } from '@/features/employees/queries';
import { PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function EmployeesPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/employees');

  const { title, subtitle } = PAGE_META['/employees'];

  // Fetched here, filtered in the client component: the whole roster is 20–50 rows, so one
  // query beats a round trip per keystroke (see `employeesListQuery`). Deactivated people
  // are included on purpose — the status ▾ needs them, and /employees is where an
  // offboarding gets confirmed.
  const employees = await employeesListQuery();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <AddEmployeeDialog />
      </div>

      {/* PUL-206 Stage 2 makes these cards open the detail drawer (edit / change role /
          deactivate). Stage 1 is read-only. */}
      <EmployeesGrid employees={employees} />
    </div>
  );
}
