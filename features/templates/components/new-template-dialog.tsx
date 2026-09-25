// features/templates/components/new-template-dialog.tsx — PUL-503 Stage 2, §14.4.1
//
// "+ New Template" → modal (name · category ▾ · description · roles), calling §13.3.6a
// `createTemplate`. Save creates an EMPTY template and navigates straight to its detail view,
// where months are added (§14.4.1).
//
// The form body is rendered only while the dialog is open, so MOUNTING IS THE RESET: state is
// seeded at mount and never cleared by hand on close. The same rule as client-form.tsx, which
// also keeps clear of the Base UI controlled-dialog trap. This modal has no on-open fetch.
//
// Rendered only for roles with `template.create` (the page decides; HR does not see it, §14.4.1).
// The action re-checks the permission regardless (§9.5 rule 2).

'use client';

import { useRouter } from 'next/navigation';
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
import { Textarea } from '@/components/ui/textarea';
import { showErrorToast } from '@/lib/show-error-toast';
import { createTemplate } from '../actions';
import { TEMPLATE_CATEGORIES, TEMPLATE_ROLES } from '../display';
import { CreateTemplateInput } from '../schema';

/** The Select's "no category" value. Base UI Select values are strings. */
const NONE = '__none__';

export function NewTemplateDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger render={<Button>+ New Template</Button>} />
      <DialogContent className="sm:max-w-md">{open ? <NewTemplateForm /> : null}</DialogContent>
    </Dialog>
  );
}

function NewTemplateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(NONE);
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function toggleRole(role: string, on: boolean) {
    // Kept in TEMPLATE_ROLES order whatever order they were ticked in.
    setRoles((current) =>
      TEMPLATE_ROLES.filter((r) => (r === role ? on : current.includes(r))),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Blank optional fields are omitted rather than sent as "".
    const input = {
      name: name.trim(),
      category: category === NONE ? undefined : category,
      description: description.trim() || undefined,
      roles,
    };

    // Inline check with the SAME schema the action parses: a convenience, not the gate.
    const parsed = CreateTemplateInput.safeParse(input);
    if (!parsed.success) {
      setNameError('Give the template a name.');
      return;
    }

    setNameError(undefined);
    setSubmitting(true);
    try {
      const result = await createTemplate(input);
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`${result.data.name} created. Add its first month next.`);
      // Straight into the detail view (§14.4.1). The dialog unmounts with the page.
      router.push(`/templates/${result.data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New template</DialogTitle>
        <DialogDescription>
          Starts empty. You&apos;ll add months, categories and tasks on the next screen.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tpl-name">Name</Label>
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            autoFocus
          />
          {nameError ? <p className="text-destructive text-xs">{nameError}</p> : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="tpl-category">Category</Label>
          <Select value={category} onValueChange={(v: string | null) => setCategory(v ?? NONE)}>
            <SelectTrigger id="tpl-category" className="w-full">
              {/* The children function: without an `items` map, a bare SelectValue would show
                  the raw sentinel for "no category". */}
              <SelectValue>{(v: string | null) => (v === null || v === NONE ? 'None' : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {TEMPLATE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="tpl-description">Description</Label>
          <Textarea
            id="tpl-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            rows={3}
          />
        </div>

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-xs font-medium">Roles</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {TEMPLATE_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={(e) => toggleRole(role, e.target.checked)}
                  className="size-3.5"
                />
                {role}
              </label>
            ))}
          </div>
        </fieldset>
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
          {submitting ? 'Creating…' : 'Create template'}
        </Button>
      </DialogFooter>
    </form>
  );
}
