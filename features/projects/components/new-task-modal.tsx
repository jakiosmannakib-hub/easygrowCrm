// features/projects/components/new-task-modal.tsx — PUL-408 Stage 2, §14.3.8 / §13.4.1
//
// The New Task modal. Fields are §13.4.1's, and the payload is validated by the SAME
// `CreateTaskInput` the action parses (imported from schema.ts, never restated) — §9.5 r.2: the
// UI validating early is a convenience, the action re-parsing is the gate.
//
// `defaultCategory` exists for PUL-409's per-column "+ Add task in {Category}": the board opens
// this same modal with the group's category pre-filled (§14.3.8 — "category pre-filled when
// opened from a category group").

'use client';

import { useEffect, useState } from 'react';
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
import { showErrorToast } from '@/lib/show-error-toast';
import { createTask, loadNewTaskContext } from '../actions';
import { PRIORITY_LABELS, type TaskPriority } from '../display';
import { CreateTaskInput } from '../schema';

/** The "leave it unset" sentinel for the optional pickers. Not an id, and never submitted. */
const NONE = 'none';

type NewTaskContext = Extract<
  Awaited<ReturnType<typeof loadNewTaskContext>>,
  { ok: true }
>['data'];

export function NewTaskModal({
  projectId,
  defaultCategory,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  /** Pre-fills Category — PUL-409 opens this modal from a board column (§14.3.8). */
  defaultCategory?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Reports Base UI's own closes only — Escape, an outside press, the Cancel button.
      //
      // The body below owns the fetch and mounts only while open, which is the fix for the
      // controlled-dialog trap this codebase has hit twice: Base UI calls `onOpenChange` only
      // from its internal `setOpen`, and a controlled `open` prop is synced straight into the
      // store (`useControlledProp`), bypassing it. An effect hung off `onOpenChange` would
      // never run on the way IN.
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Title and category are required. Everything else can be filled in later.
          </DialogDescription>
        </DialogHeader>

        {/*
          Mounted per opening and keyed by project + category: MOUNTING IS THE RESET. Every
          field is seeded at mount, so re-opening starts clean with no state to clear and the
          effect never has to setState synchronously to undo a previous visit.
        */}
        {open ? (
          <NewTaskBody
            key={`${projectId}:${defaultCategory ?? ''}`}
            projectId={projectId}
            defaultCategory={defaultCategory}
            onOpenChange={onOpenChange}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewTaskBody({
  projectId,
  defaultCategory,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  defaultCategory?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [context, setContext] = useState<NewTaskContext | null>(null);

  /**
   * **Every field declared upfront (§16.10)** — including the ones the user may never touch.
   * No lazy `if (!form.x)` initializer anywhere, which is the §14.16 bug this principle exists
   * to prevent.
   *
   * All values are strings (and booleans), even `month` and `estimatedHours`, which are numbers
   * in `CreateTaskInput`. Inputs and Base UI selects speak strings, so the single conversion
   * happens once in `buildPayload` rather than in every handler.
   *
   * `qcRequired` defaults to true and `proofRequired` / `clientVisible` to false, matching the
   * column defaults in §11.3 — the form's defaults and the schema's must not disagree, or a
   * task created through the UI differs from one created any other way.
   */
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(defaultCategory ?? '');
  const [month, setMonth] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [sopUrl, setSopUrl] = useState('');
  const [qcRequired, setQcRequired] = useState(true);
  const [proofRequired, setProofRequired] = useState(false);
  const [clientVisible, setClientVisible] = useState(false);
  const [dependsOn, setDependsOn] = useState(NONE);
  const [checklist, setChecklist] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let current = true;

    void (async () => {
      const result = await loadNewTaskContext({ projectId });
      if (!current) return;

      if (!result.ok) {
        // The pickers stay empty; title/category alone still make a valid task, so the form
        // remains usable rather than being blocked on a list it only needs for optional fields.
        showErrorToast(result);
        return;
      }
      setContext(result.data);
    })();

    return () => {
      current = false;
    };
  }, [projectId]);

  const assignable = context?.assignable ?? [];
  const dependencyOptions = context?.dependencyOptions ?? [];

  /**
   * Form state → `CreateTaskInput`. The one place a string becomes a number and an empty field
   * becomes an ABSENT key rather than an empty string.
   *
   * That distinction matters: `description: ''` would store an empty string where §13.4.1 means
   * "no description", and `dueDate: ''` would fail `z.iso.date()` for a field the user simply
   * left alone.
   */
  function buildPayload() {
    const trimmedChecklist = checklist
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      projectId,
      title: title.trim(),
      category: category.trim(),
      month: month.trim() === '' ? undefined : Number(month),
      description: description.trim() === '' ? undefined : description.trim(),
      assigneeId: assigneeId === NONE ? undefined : assigneeId,
      // Already `YYYY-MM-DD` — `<input type="date">` produces exactly that, and it stays a
      // string end to end. Constructing a `Date` here is how a due date slips a day (§11.0).
      dueDate: dueDate === '' ? undefined : dueDate,
      priority,
      estimatedHours: estimatedHours.trim() === '' ? undefined : Number(estimatedHours),
      expectedOutput: expectedOutput.trim() === '' ? undefined : expectedOutput.trim(),
      sopUrl: sopUrl.trim() === '' ? undefined : sopUrl.trim(),
      qcRequired,
      proofRequired,
      clientVisible,
      dependsOn: dependsOn === NONE ? undefined : dependsOn,
      checklist: trimmedChecklist.length === 0 ? undefined : trimmedChecklist,
    };
  }

  async function onSubmit() {
    const payload = buildPayload();

    // Parsed with the ACTION'S OWN schema — not a second set of rules that can drift from it.
    // This is a convenience so the user sees the problem without a round trip; the action
    // re-parses and is the real gate.
    const parsed = CreateTaskInput.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createTask(parsed.data);
      if (!result.ok) {
        // Including GATE:project_archived and the dependency/assignee refusals.
        showErrorToast(result);
        return;
      }

      // Not optimistic — creating work is an accountability action, and the header's progress
      // denominator moves with it (§14.15 r.5).
      toast.success('Task created.');
      onOpenChange(false);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid max-h-[60vh] gap-3 overflow-y-auto px-1">
        <Field label="Title" htmlFor="nt-title">
          <Input
            id="nt-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="nt-category">
            <Input
              id="nt-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. On-page SEO"
            />
          </Field>

          <Field label="Month" htmlFor="nt-month" hint="Leave blank for one-off work">
            <Input
              id="nt-month"
              type="number"
              min={1}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee" htmlFor="nt-assignee">
            <Select
              value={assigneeId}
              onValueChange={(v: string | null) => setAssigneeId(v ?? NONE)}
            >
              <SelectTrigger id="nt-assignee" className="w-full">
                {/*
                  The children FUNCTION is required. Left bare, `Select.Value` falls through to
                  `String(value)` — the raw user id — because no `items` map is passed to the
                  Root. Same trap and same fix as the Task Detail Assign ▾ (PUL-407).
                */}
                <SelectValue>
                  {(v: string | null) =>
                    v === null || v === NONE
                      ? 'Unassigned'
                      : (assignable.find((u) => u.id === v)?.name ?? 'Unassigned')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {assignable.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Due date" htmlFor="nt-due">
            <Input
              id="nt-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="nt-priority">
            <Select
              value={priority}
              onValueChange={(v: string | null) => setPriority((v as TaskPriority) ?? 'medium')}
            >
              <SelectTrigger id="nt-priority" className="w-full">
                <SelectValue>
                  {(v: string | null) => PRIORITY_LABELS[(v as TaskPriority) ?? 'medium']}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Estimated hours" htmlFor="nt-est">
            <Input
              id="nt-est"
              type="number"
              min={0}
              step="0.25"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Depends on" htmlFor="nt-depends" hint="Another live task in this project">
          <Select value={dependsOn} onValueChange={(v: string | null) => setDependsOn(v ?? NONE)}>
            <SelectTrigger id="nt-depends" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  v === null || v === NONE
                    ? 'No dependency'
                    : (dependencyOptions.find((t) => t.id === v)?.title ?? 'No dependency')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No dependency</SelectItem>
              {dependencyOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Description" htmlFor="nt-description">
          <textarea
            id="nt-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="border-input bg-input/20 focus-visible:border-ring focus-visible:ring-ring/30 w-full rounded-md border px-2 py-1.5 text-xs outline-none focus-visible:ring-2"
          />
        </Field>

        <Field label="Expected output" htmlFor="nt-output">
          <Input
            id="nt-output"
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
          />
        </Field>

        <Field label="SOP link" htmlFor="nt-sop">
          <Input id="nt-sop" value={sopUrl} onChange={(e) => setSopUrl(e.target.value)} />
        </Field>

        <Field
          label="Checklist"
          htmlFor="nt-checklist"
          hint="One item per line — this is the definition of done, and it gates submission"
        >
          <textarea
            id="nt-checklist"
            value={checklist}
            onChange={(e) => setChecklist(e.target.value)}
            rows={3}
            className="border-input bg-input/20 focus-visible:border-ring focus-visible:ring-ring/30 w-full rounded-md border px-2 py-1.5 text-xs outline-none focus-visible:ring-2"
          />
        </Field>

        <div className="flex flex-wrap gap-4 pt-1">
          <Toggle label="QC required" checked={qcRequired} onChange={setQcRequired} />
          <Toggle label="Proof required" checked={proofRequired} onChange={setProofRequired} />
          <Toggle label="Client visible" checked={clientVisible} onChange={setClientVisible} />
        </div>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button">
              Cancel
            </Button>
          }
        />
        <Button onClick={() => void onSubmit()} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create task'}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5"
      />
      {label}
    </label>
  );
}
