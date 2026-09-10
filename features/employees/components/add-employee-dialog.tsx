// features/employees/components/add-employee-dialog.tsx — PUL-202.3, §14.12
//
// "+ Add Employee" → modal (email, name, role ▾, title, dept, join date), calling §13.1.1
// `createEmployee`. The page it sits on is already SA/HR-only via the PUL-110 route guard,
// and the action re-checks `employee.create` regardless — the UI hides, the API refuses
// (§9.5 rule 2). PUL-206 builds the card grid and filters around this button.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { userRole } from '@/db/schema/enums';
import { showErrorToast } from '@/lib/show-error-toast';
import { createEmployee } from '../actions';
import { ROLE_LABELS } from '../display';
import { CreateEmployeeInput } from '../schema';

const EMPTY = {
  email: '',
  name: '',
  role: 'employee',
  title: '',
  department: '',
  joinDate: '',
};

type FormState = typeof EMPTY;

export function AddEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Blank optional fields are omitted rather than sent as "" — the schema's `.optional()`
   * means absent, and an empty string would fail `z.iso.date()` on joinDate.
   */
  function toInput(f: FormState) {
    return {
      email: f.email.trim(),
      name: f.name.trim(),
      role: f.role,
      title: f.title.trim() || undefined,
      department: f.department.trim() || undefined,
      joinDate: f.joinDate || undefined,
    };
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Inline validation with the SAME schema the action parses. This is a convenience,
    // not a gate — createEmployee re-parses server-side and is the real boundary.
    const parsed = CreateEmployeeInput.safeParse(toInput(form));
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
    setSubmitting(true);
    try {
      const result = await createEmployee(parsed.data);
      if (!result.ok) {
        // Every server error goes through the PUL-106 mapper — including CONFLICT on a
        // duplicate email, which is the one code that offers "Refresh" (§14.15 r.3).
        // It arrives as a returned value, not a throw, so the code survives a production
        // build (PUL-111); the modal stays open with the fields intact.
        showErrorToast(result);
        return;
      }
      // Not optimistic: adding a person is an accountability action, so the modal stays
      // open until the server confirms (§14.15 r.5).
      toast.success(`${parsed.data.name} added.`);
      setForm(EMPTY);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) {
          setForm(EMPTY);
          setErrors({});
        }
      }}
    >
      <DialogTrigger render={<Button>+ Add Employee</Button>} />

      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
            <DialogDescription>
              They&apos;ll sign in with their company Google account. No invitation email is sent.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <Field id="email" label="Email" error={errors.email}>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@company.com"
                autoComplete="off"
              />
            </Field>

            <Field id="name" label="Full name" error={errors.name}>
              <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>

            <Field id="role" label="Role" error={errors.role}>
              <Select
                value={form.role}
                onValueChange={(value: string | null) => set('role', value ?? 'employee')}
              >
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userRole.enumValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field id="title" label="Title" error={errors.title}>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Optional"
              />
            </Field>

            <Field id="department" label="Department" error={errors.department}>
              <Input
                id="department"
                value={form.department}
                onChange={(e) => set('department', e.target.value)}
                placeholder="Optional"
              />
            </Field>

            <Field id="joinDate" label="Join date" error={errors.joinDate}>
              {/* type="date" yields a YYYY-MM-DD string — never a Date object, which a
                  timezone could shift across a Dhaka day boundary (§11.0). */}
              <Input
                id="joinDate"
                type="date"
                value={form.joinDate}
                onChange={(e) => set('joinDate', e.target.value)}
              />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
