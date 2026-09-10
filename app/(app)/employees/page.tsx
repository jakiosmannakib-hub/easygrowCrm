// app/(app)/employees/page.tsx — PUL-110.4, extended by PUL-202.3 and PUL-206

import { AddEmployeeDialog } from '@/features/employees/components/add-employee-dialog';
import { EmployeesGrid } from '@/features/employees/components/employees-grid';
import { activeUsersQuery, employeesListQuery } from '@/features/employees/queries';
import { PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function EmployeesPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  //
  // It returns the DB-read viewer (§9.5 r.4), which the drawer needs for two DIFFERENT
  // reasons: `role` decides whether the Change-role control renders at all (§14.1 curated
  // visibility — the action still authorizes SA-only, so this is presentation), and `id` lets
  // the drawer explain up front that nobody changes their own role or deactivates themselves.
  const viewer = await requireRouteAccess('/employees');

  const { title, subtitle } = PAGE_META['/employees'];

  // Fetched here, filtered in the client component: the whole roster is 20–50 rows, so one
  // query beats a round trip per keystroke (see `employeesListQuery`). Deactivated people
  // are included on purpose — the status ▾ needs them, and /employees is where an
  // offboarding gets confirmed.
  // `activeUsersQuery` alongside the roster: the offboarding modal's reassign / reroute
  // pickers must never offer a deactivated person new work, and that filter belongs in the
  // shared query rather than in this page (§14.15 r.9).
  const [employees, pickableUsers] = await Promise.all([employeesListQuery(), activeUsersQuery()]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <AddEmployeeDialog />
      </div>

      <EmployeesGrid
        employees={employees}
        viewerRole={viewer.role}
        viewerId={viewer.id}
        pickableUsers={pickableUsers}
      />
    </div>
  );
}
