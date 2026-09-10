// features/employees/components/employee-detail-sheet.tsx — PUL-206.3 (Stage 2), §14.12
//
// The employee detail drawer: edit fields (§13.1.2) + change role (§13.1.3, SA only).
// A Sheet rather than a route, per §14.12 — the grid stays behind it, so an HR user working
// down the roster never loses their filters to a navigation.
//
// Stage 3 adds Deactivate / the offboarding checklist (§13.1.4) where marked below.

'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { userRole } from '@/db/schema/enums';
import { showErrorToast } from '@/lib/show-error-toast';
import { changeRole, updateEmployee } from '../actions';
import { ROLE_LABELS, displayNameParts, initials } from '../display';
import type { EmployeeCard } from '../queries';
import { UpdateEmployeeInput } from '../schema';

type Role = (typeof userRole.enumValues)[number];

/**
 * The edit form's state. All strings, because that is what `<input>` gives back — the
 * conversion to the wire shape (`""` → `null`, absent → untouched) happens once, in
 * `buildPatch`, rather than being re-derived per field at submit time.
 */
type FormState = {
  name: string;
  title: string;
  department: string;
  joinDate: string;
};

function formFor(employee: EmployeeCard): FormState {
  return {
    name: employee.name,
    title: employee.title ?? '',
    department: employee.department ?? '',
    joinDate: employee.joinDate ?? '',
  };
}

/**
 * The §13.1.2 payload for what the user actually touched.
 *
 * Three rules, all of them the action's convention (see `updateEmployee`):
 *   - an **absent** key means "leave alone" — so an untouched field is omitted, never resent
 *     as its current value, which would otherwise put an unchanged field in the audit diff;
 *   - **`null`** means "clear it" — an emptied title / department / join date;
 *   - **name is required** and so is never nulled; an empty name is a validation error, not
 *     an instruction to erase somebody's name.
 *
 * Returns `null` when nothing moved, which the caller uses to skip the round trip entirely
 * (`UpdateEmployeeInput` refuses an empty patch, and rightly — it's a caller bug, not a
 * no-op request).
 */
function buildPatch(form: FormState, employee: EmployeeCard) {
  const patch: Record<string, string | null> = {};

  const name = form.name.trim();
  if (name !== employee.name) patch.name = name;

  const title = form.title.trim() || null;
  if (title !== (employee.title ?? null)) patch.title = title;

  const department = form.department.trim() || null;
  if (department !== (employee.department ?? null)) patch.department = department;

  const joinDate = form.joinDate || null;
  if (joinDate !== employee.joinDate) patch.joinDate = joinDate;

  return Object.keys(patch).length === 0 ? null : { userId: employee.id, ...patch };
}

export function EmployeeDetailSheet({
  employee,
  viewerRole,
  viewerId,
  onOpenChange,
}: {
  /** `null` closes the drawer. The grid owns which row is selected. */
  employee: EmployeeCard | null;
  viewerRole: Role;
  viewerId: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={employee !== null} onOpenChange={onOpenChange}>
      {employee ? (
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {/*
            Keyed by id, so opening a different person REMOUNTS the body — that remount is
            what resets the form. The alternative, an effect calling setForm when the prop
            changes, is the cascading-render pattern React's lint rule rejects, and it is
            genuinely worse here: a remount can't half-apply, so there is no frame where this
            person's name sits above that person's title.

            The key deliberately does NOT change after a save. It doesn't need to — what the
            user typed already equals what was stored, and `patch` recomputes against the
            refreshed row, so Save just returns to disabled.
          */}
          <EmployeeDetailBody
            key={employee.id}
            employee={employee}
            viewerRole={viewerRole}
            viewerId={viewerId}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function EmployeeDetailBody({
  employee,
  viewerRole,
  viewerId,
}: {
  employee: EmployeeCard;
  viewerRole: Role;
  viewerId: string;
}) {
  const router = useRouter();

  // Declared upfront, seeded from props at mount — no lazy initializers, no effect
  // (CLAUDE.md §2, state discipline).
  const [form, setForm] = useState<FormState>(() => formFor(employee));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [nextRole, setNextRole] = useState<Role>(employee.role);
  const [confirmingRole, setConfirmingRole] = useState(false);
  const [changingRole, setChangingRole] = useState(false);

  const patch = useMemo(() => buildPatch(form, employee), [form, employee]);

  const { name, suffix } = displayNameParts(employee);
  // §14.1 curated visibility — NOT a security control. `changeRole` authorizes
  // `employee.change_role` server-side regardless of what this renders (§9.5 r.2).
  const canChangeRole = viewerRole === 'super_admin';

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();

    if (!patch) {
      toast.info('No changes to save.');
      return;
    }

    // The same schema the action parses — a convenience, not the gate (§9.5 r.2).
    const parsed = UpdateEmployeeInput.safeParse(patch);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      await updateEmployee(parsed.data);
      // Not optimistic — an edit to the employee record waits for the server (§14.15 r.5).
      toast.success('Changes saved.');
      // Re-runs the server component, so the card behind the drawer shows the new values
      // without a manual reload.
      router.refresh();
    } catch (error) {
      showErrorToast(error as { code: string; message?: string });
    } finally {
      setSaving(false);
    }
  }

  async function onApplyRole() {
    setChangingRole(true);
    try {
      await changeRole({ userId: employee.id, role: nextRole });
      toast.success(`Role changed to ${ROLE_LABELS[nextRole]}.`);
      setConfirmingRole(false);
      router.refresh();
    } catch (error) {
      // GATE:self_role_change and GATE:last_managers both land here and are named by the
      // PUL-106 mapper — a blocked role change explains itself instead of throwing.
      showErrorToast(error as { code: string; message?: string });
    } finally {
      setChangingRole(false);
    }
  }

  return (
    <>
      <SheetHeader className="space-y-0">
        <div className="flex items-start gap-3 pr-8">
          <Avatar size="lg">
            {employee.image ? <AvatarImage src={employee.image} alt="" /> : null}
            <AvatarFallback>{initials(employee.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-sm">
              {name}
              {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
            </SheetTitle>
            <SheetDescription className="truncate">{employee.email}</SheetDescription>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{ROLE_LABELS[employee.role]}</Badge>
              <Badge variant={employee.active ? 'secondary' : 'outline'}>
                {employee.active ? 'Active' : 'Deactivated'}
              </Badge>
            </div>
          </div>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <form onSubmit={onSave} className="space-y-3">
          <h3 className="text-xs font-medium">Details</h3>

          <Field id="edit-name" label="Full name" error={errors.name}>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field id="edit-title" label="Title" error={errors.title}>
            <Input
              id="edit-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Optional"
            />
          </Field>

          <Field id="edit-department" label="Department" error={errors.department}>
            <Input
              id="edit-department"
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              placeholder="Optional"
            />
          </Field>

          <Field id="edit-join-date" label="Join date" error={errors.joinDate}>
            {/* type="date" yields a YYYY-MM-DD string — never a Date object, which a
                timezone could shift across a Dhaka day boundary (§11.0). */}
            <Input
              id="edit-join-date"
              type="date"
              value={form.joinDate}
              onChange={(e) => set('joinDate', e.target.value)}
            />
          </Field>

          <p className="text-muted-foreground text-xs">
            Email can&apos;t be changed — it&apos;s the Google account they sign in with.
          </p>

          <Button type="submit" disabled={saving || !patch}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        {canChangeRole ? (
          <div className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-xs font-medium">Role</h3>
              <p className="text-muted-foreground text-xs">
                Takes effect on their next request.
              </p>
            </div>

            <Select
              value={nextRole}
              onValueChange={(value: string | null) => {
                setNextRole((value as Role) ?? employee.role);
                // Any change to the selection cancels a pending confirmation, so Confirm can
                // never apply a role the user didn't just read.
                setConfirmingRole(false);
              }}
            >
              <SelectTrigger aria-label="New role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {confirmingRole ? (
              <div className="bg-muted/50 space-y-2 rounded-md border p-3">
                <p className="text-xs">
                  Change {employee.name} from <strong>{ROLE_LABELS[employee.role]}</strong> to{' '}
                  <strong>{ROLE_LABELS[nextRole]}</strong>?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={onApplyRole} disabled={changingRole}>
                    {changingRole ? 'Applying…' : 'Confirm'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmingRole(false)}
                    disabled={changingRole}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={nextRole === employee.role}
                onClick={() => setConfirmingRole(true)}
              >
                Change role
              </Button>
            )}

            {employee.id === viewerId ? (
              <p className="text-muted-foreground text-xs">
                This is your own account — another super admin has to change your role.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ── PUL-206 Stage 3 ─────────────────────────────────────────────────────
            Deactivate / Reactivate goes here: the §13.1.4 offboarding checklist modal
            (open assignments → reassign ▾ / cancel, routed reviews → reroute ▾), with
            Deactivate disabled until every row is resolved and blocked outright when it
            would leave fewer than two active managers. `getDeactivationBlockers` and
            `deactivateEmployee` already exist from PUL-205.
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="border-t pt-4">
          <h3 className="text-xs font-medium">Account status</h3>
          <p className="text-muted-foreground text-xs">
            Deactivation arrives in the next stage of this ticket.
          </p>
        </div>
      </div>
    </>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
