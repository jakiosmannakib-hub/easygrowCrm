// features/employees/components/employees-grid.tsx — PUL-206.1 / 206.2, §14.12
//
// The employee directory: card grid + dept / status / name filters.
//
// Read-only in Stage 1. The card is not yet clickable — PUL-206 Stage 2 turns it into the
// trigger for the detail drawer (edit §13.1.2, change role §13.1.3, deactivate §13.1.4).
//
// The whole list arrives from the server component as a prop and every filter runs in memory:
// a 20–50-person org (CLAUDE.md preamble) is far below the size where paging or a server-side
// WHERE earns its round trip, and a filter that responds on keypress beats one that doesn't.

'use client';

import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLE_LABELS, displayNameParts, initials } from '../display';
import type { EmployeeCard } from '../queries';

/**
 * §14.12's status ▾. Defaults to Active — the everyday question this page answers is "who
 * works here", and a directory that opens on a mix of current and former staff makes the
 * reader do the filtering. Deactivated people stay one click away, never hidden outright.
 */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'all', label: 'All statuses' },
] as const;

type Status = (typeof STATUS_OPTIONS)[number]['value'];

/** The sentinel for "no department filter". Not a real department, so it can't collide. */
const ALL_DEPTS = '__all__';

export function EmployeesGrid({ employees }: { employees: EmployeeCard[] }) {
  const [status, setStatus] = useState<Status>('active');
  const [department, setDepartment] = useState<string>(ALL_DEPTS);
  const [search, setSearch] = useState('');

  /**
   * The dept ▾ options come from the data, not a hardcoded list — departments are free text
   * on `user` (§11), so the only honest source is what people actually have. Recomputed only
   * when the roster changes, and deliberately NOT narrowed by the other filters: options that
   * vanish as you type make the control feel broken.
   */
  const departments = useMemo(() => {
    const seen = new Set<string>();
    for (const e of employees) {
      const dept = e.department?.trim();
      if (dept) seen.add(dept);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (status === 'active' && !e.active) return false;
      if (status === 'deactivated' && e.active) return false;
      if (department !== ALL_DEPTS && e.department?.trim() !== department) return false;
      // Case-insensitive contains, per the ticket. Matches the stored name only — the
      // "(deactivated)" suffix is presentation and must not be searchable, or typing "de"
      // would silently pull in every former employee.
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [employees, status, department, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search employees by name"
          className="w-full sm:max-w-56"
        />

        <Select
          value={department}
          onValueChange={(value: string | null) => setDepartment(value ?? ALL_DEPTS)}
        >
          <SelectTrigger aria-label="Filter by department" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DEPTS}>All departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept} value={dept}>
                {dept}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(value: string | null) => setStatus((value as Status) ?? 'active')}
        >
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-auto text-xs">
          {visible.length} of {employees.length}
        </span>
      </div>

      {visible.length === 0 ? (
        // §14.15 r.4 — every list gets an empty state with a one-line explanation.
        <Card className="text-muted-foreground p-8 text-center text-sm">
          No employees match these filters.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((employee) => (
            <EmployeeGridCard key={employee.id} employee={employee} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeGridCard({ employee }: { employee: EmployeeCard }) {
  // §14.15 r.9 — a deactivated person keeps their name and gains a muted suffix.
  const { name, suffix } = displayNameParts(employee);

  return (
    <Card className="flex flex-row items-start gap-3 p-4">
      <Avatar size="lg">
        {/* No `image` until the person first signs in with Google, so the initials fallback
            is the normal state for a freshly provisioned account, not an error case. */}
        {employee.image ? <AvatarImage src={employee.image} alt="" /> : null}
        <AvatarFallback>{initials(employee.name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {name}
              {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {employee.title?.trim() || '—'}
            </p>
          </div>

          <Badge variant={employee.active ? 'secondary' : 'outline'}>
            {employee.active ? 'Active' : 'Deactivated'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{ROLE_LABELS[employee.role]}</Badge>
          {employee.department?.trim() ? (
            <Badge variant="ghost">{employee.department.trim()}</Badge>
          ) : null}
        </div>

        <p className="text-muted-foreground truncate text-xs">{employee.email}</p>
      </div>
    </Card>
  );
}
