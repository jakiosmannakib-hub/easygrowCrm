// features/projects/components/new-task-modal.tsx — PUL-408 Stage 2, §14.3.8 / §13.4.1
//
// The New Task modal. Fields are §13.4.1's, and the payload is validated by the SAME
// `CreateTaskInput` the action parses (imported from schema.ts, never restated) — §9.5 r.2: the
// UI validating early is a convenience, the action re-parsing is the gate.
//
// `defaultCategory` exists for PUL-409's per-column "+ Add task in {Category}": the board opens
// this same modal with the group's category pre-filled (§14.3.8 — "category pre-filled when
// opened from a category group").
//
// `defaultMonth` and `categoriesByMonth` exist for PUL-421's "+ Add task" on a List Month header:
// Month opens on that month but stays editable, and Category suggests the categories already in
// the chosen month while still taking free text for a new one.

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
import {
  monthLabel,
  monthNumberLabel,
  ONBOARDING_MONTH,
  PRIORITY_LABELS,
  type TaskPriority,
} from '../display';
import { CreateTaskInput } from '../schema';

/** The "leave it unset" sentinel for the optional pickers. Not an id, and never submitted. */
const NONE = 'none';

/**
 * Month ▾ offers Onboarding (Month 0, PUL-419) first, then Month 1 to 12 (§14.3.8, PUL-421); a
 * later prefilled month is added to it.
 */
const MONTH_CHOICES = [ONBOARDING_MONTH, ...Array.from({ length: 12 }, (_, i) => i + 1)];

/** What `onCreated` reports, so the opener can reveal the group the new task landed in. */
export interface CreatedTaskPlacement {
  month: number | null;
  category: string;
}

type NewTaskContext = Extract<
  Awaited<ReturnType<typeof loadNewTaskContext>>,
  { ok: true }
>['data'];

/** The pre-fills an opener may pass. All optional: `+ New Task` in the header passes none. */
interface NewTaskPrefill {
  /** Pre-fills Category: PUL-409 opens this modal from a board column (§14.3.8). */
  defaultCategory?: string;
  /** Pre-fills Month (PUL-421, a List Month header). `null` or absent means no month. */
  defaultMonth?: number | null;
  /**
   * The categories already in each month (`null` = Unscheduled), for Category's suggestions.
   * Follows Month as it changes. Absent means no suggestions, only free text.
   */
  categoriesByMonth?: ReadonlyMap<number | null, readonly string[]>;
  /** The project's start date, so Month ▾ reads `Month 3` plus its calendar month. */
  projectStartDate?: string;
}

export function NewTaskModal({
  projectId,
  defaultCategory,
  defaultMonth,
  categoriesByMonth,
  projectStartDate,
  open,
  onOpenChange,
  onCreated,
}: NewTaskPrefill & {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports where the task landed, so the opener can reveal that group. */
  onCreated: (placement: CreatedTaskPlacement) => void;
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
          Mounted per opening and keyed by project + category + month: MOUNTING IS THE RESET. Every
          field is seeded at mount, so re-opening starts clean with no state to clear and the
          effect never has to setState synchronously to undo a previous visit.
        */}
        {open ? (
          <NewTaskBody
            key={`${projectId}:${defaultCategory ?? ''}:${defaultMonth ?? ''}`}
            projectId={projectId}
            defaultCategory={defaultCategory}
            defaultMonth={defaultMonth}
            categoriesByMonth={categoriesByMonth}
            projectStartDate={projectStartDate}
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
  defaultMonth,
  categoriesByMonth,
  projectStartDate,
  onOpenChange,
  onCreated,
}: NewTaskPrefill & {
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (placement: CreatedTaskPlacement) => void;
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
   * `proofRequired` / `clientVisible` default to false, matching the
   * column defaults in §11.3 — the form's defaults and the schema's must not disagree, or a
   * task created through the UI differs from one created any other way.
   *
   * There is no QC toggle: Amendment M makes review mandatory (PUL-416), so `qcRequired` is
   * never sent and the column default (true) applies.
   */
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(defaultCategory ?? '');
  const [month, setMonth] = useState(defaultMonth == null ? NONE : String(defaultMonth));
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [sopUrl, setSopUrl] = useState('');
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

  const monthNum = month === NONE ? null : Number(month);
  // A prefilled month past 12 (a long template) stays choosable rather than silently dropped.
  const monthChoices =
    defaultMonth != null && !MONTH_CHOICES.includes(defaultMonth)
      ? [...MONTH_CHOICES, defaultMonth].sort((a, b) => a - b)
      : MONTH_CHOICES;
  const monthName = (m: number) =>
    projectStartDate === undefined ? monthNumberLabel(m) : monthLabel(projectStartDate, m);
  const categorySuggestions = categoriesByMonth?.get(monthNum) ?? [];

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
      month: month === NONE ? undefined : Number(month),
      description: description.trim() === '' ? undefined : description.trim(),
      assigneeId: assigneeId === NONE ? undefined : assigneeId,
      // Already `YYYY-MM-DD` — `<input type="date">` produces exactly that, and it stays a
      // string end to end. Constructing a `Date` here is how a due date slips a day (§11.0).
      dueDate: dueDate === '' ? undefined : dueDate,
      priority,
      estimatedHours: estimatedHours.trim() === '' ? undefined : Number(estimatedHours),
      expectedOutput: expectedOutput.trim() === '' ? undefined : expectedOutput.trim(),
      sopUrl: sopUrl.trim() === '' ? undefined : sopUrl.trim(),
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
      onCreated({ month: parsed.data.month ?? null, category: parsed.data.category });
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
          <Field
            label="Category"
            htmlFor="nt-category"
            hint={
              categorySuggestions.length > 0
                ? 'Pick one already in this month, or type a new one'
                : undefined
            }
          >
            {/*
              A native datalist, not a Select: it suggests the month's existing categories and
              still takes free text, which a new category needs. `list` is only set when there
              is something to suggest.
            */}
            <Input
              id="nt-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. On-page SEO"
              list={categorySuggestions.length > 0 ? 'nt-category-options' : undefined}
              autoComplete="off"
            />
            {categorySuggestions.length > 0 ? (
              <datalist id="nt-category-options">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            ) : null}
          </Field>

          <Field label="Month" htmlFor="nt-month" hint="No month for one-off work">
            <Select value={month} onValueChange={(v: string | null) => setMonth(v ?? NONE)}>
              <SelectTrigger id="nt-month" className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v === null || v === NONE ? 'No month' : monthName(Number(v))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No month</SelectItem>
                {monthChoices.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {monthName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
