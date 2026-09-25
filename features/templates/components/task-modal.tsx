// features/templates/components/task-modal.tsx — PUL-503 Stage 3b, §14.4.4
//
// The ONE Add/Edit Task modal, for both modes. `target.task === null` is add (into
// `target.categoryId`); otherwise it edits that task.
//
// ── Mounting is the reset ────────────────────────────────────────────────────────────────
// The dialog is controlled and has no `DialogTrigger` (it is opened from the tree by flipping
// state), which is exactly the Base UI trap where `onOpenChange` never fires on the way IN. So
// nothing hangs off `onOpenChange` except closing, and there is no on-open fetch: the body is
// mounted only while a target is set, KEYED by the task id (or `new:<categoryId>`), and seeds its
// state from the task at mount. Switching from one task to another remounts the body, so a field
// from the previous task can never show; there is no effect re-seeding state.
//
// ── One Save writes everything ────────────────────────────────────────────────────────────
// The subtask list is modal-local state (§14.4.4; the prototype's `window._tftSubs` is not
// repeated). Save sends the task AND its whole subtask list in one call: `addTemplateTask` for a
// new task, `updateTemplateTask` (full replacement list, reconciled server-side) for an edit.
// There are no per-subtask actions here, by design.
//
// NOT in scope (PUL-503): moving a task to another category (the category is fixed by where the
// task was added, and `updateTemplateTask` takes no category), and inline subtask editing in the
// tree (§13.3.7e's subtask actions are not built). Existing subtasks can be removed here, not
// renamed: to rename one, remove it and create it again.
//
// Not optimistic: Save and Delete await the server; errors, including `GATE:bad_ref` for a bad
// `after` pick and `GATE:task_has_dependents` on delete, go through `showErrorToast`.

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
import { taskPriority } from '@/db/schema/enums';
import { PRIORITY_LABELS } from '@/features/projects/display';
import { showErrorToast } from '@/lib/show-error-toast';
import { addTemplateTask, deleteTemplateTask, updateTemplateTask } from '../actions';
import type { TemplateTaskNode } from '../hierarchy';
import {
  formToTaskFields,
  initialTaskForm,
  type DueKind,
  type TaskFormState,
  type TaskPriority,
} from '../task-form';
import { ConfirmDeleteButton } from './confirm-delete-button';

export interface TaskModalTarget {
  categoryId: string;
  categoryName: string;
  /** `null` = add a new task to the category. */
  task: TemplateTaskNode | null;
}

/** A task the `after` rule may point at. */
export interface DependencyOption {
  id: string;
  label: string;
}

/** The Select's "no role" value. Base UI Select values are strings. */
const NO_ROLE = '__none__';

const DUE_KIND_LABELS: Record<DueKind, string> = {
  day: 'Day N from month start',
  before_deadline: 'N days before deadline',
  after: 'After another task',
};

export function TaskModal({
  target,
  onClose,
  rolePalette,
  dependencyOptions,
}: {
  target: TaskModalTarget | null;
  onClose: () => void;
  /** `templates.roles` (§3.3.5). */
  rolePalette: string[];
  /** Every task in the template, in walk order. The body drops the task being edited. */
  dependencyOptions: DependencyOption[];
}) {
  return (
    <Dialog
      open={target !== null}
      // Base UI's own closes only (Escape, outside press, Cancel). See the file header.
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {target ? (
          <TaskModalBody
            key={target.task?.id ?? `new:${target.categoryId}`}
            target={target}
            onClose={onClose}
            rolePalette={rolePalette}
            dependencyOptions={dependencyOptions.filter((o) => o.id !== target.task?.id)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskModalBody({
  target,
  onClose,
  rolePalette,
  dependencyOptions,
}: {
  target: TaskModalTarget;
  onClose: () => void;
  rolePalette: string[];
  dependencyOptions: DependencyOption[];
}) {
  const router = useRouter();
  const { task } = target;

  const [form, setForm] = useState<TaskFormState>(() => initialTaskForm(task));
  const [errors, setErrors] = useState<Partial<Record<keyof TaskFormState, string>>>({});
  const [newSubtask, setNewSubtask] = useState('');
  // React keys for subtasks typed in this session (saved ones are keyed by their id).
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function appendSubtask() {
    const title = newSubtask.trim();
    if (!title) return;
    setForm((f) => ({ ...f, subtasks: [...f.subtasks, { key: `new-${nextKey}`, title }] }));
    setNextKey((k) => k + 1);
    setNewSubtask('');
  }

  function removeSubtask(key: string) {
    setForm((f) => ({ ...f, subtasks: f.subtasks.filter((s) => s.key !== key) }));
  }

  // The role options: the template's palette, plus the task's current role if the palette does
  // not list it (a seeded task may carry one), so opening and saving never silently drops it.
  const roleOptions =
    form.roleHint && !rolePalette.includes(form.roleHint)
      ? [...rolePalette, form.roleHint]
      : rolePalette;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const result = formToTaskFields(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    const { subtasks, ...fields } = result.fields;
    setSaving(true);
    try {
      const saved = task
        ? await updateTemplateTask({ templateTaskId: task.id, ...fields, subtasks })
        : await addTemplateTask({
            categoryId: target.categoryId,
            ...fields,
            subtasks: subtasks.map((s) => ({ title: s.title })),
          });
      if (!saved.ok) {
        showErrorToast(saved);
        return;
      }
      toast.success(task ? 'Task saved.' : `${saved.data.title} added.`);
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!task) return false;
    const result = await deleteTemplateTask({ templateTaskId: task.id });
    if (!result.ok) {
      // GATE:task_has_dependents names the blocking task (lib/error-toast.ts).
      showErrorToast(result);
      return false;
    }
    toast.success(`${task.title} deleted.`);
    onClose();
    router.refresh();
    return true;
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{task ? 'Edit task' : `Add task in ${target.categoryName}`}</DialogTitle>
        <DialogDescription>
          {task
            ? `In ${target.categoryName}. One Save writes the task and its subtasks together.`
            : 'One Save writes the task and its subtasks together.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <Field id="tt-title" label="Title" error={errors.title}>
          <Input
            id="tt-title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            aria-invalid={errors.title ? true : undefined}
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            {'{{ClientName}}'}, {'{{MonthName}}'} and {'{{ProjectName}}'} are replaced when a
            project is launched from this template.
          </p>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tt-role" label="Role">
            {rolePalette.length > 0 ? (
              <Select
                value={form.roleHint || NO_ROLE}
                onValueChange={(v: string | null) =>
                  set('roleHint', v === null || v === NO_ROLE ? '' : v)
                }
              >
                <SelectTrigger id="tt-role" className="w-full">
                  <SelectValue>
                    {(v: string | null) => (v === null || v === NO_ROLE ? 'No role' : v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>No role</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                {/* No palette declared: free text, so a template created without roles can still
                    carry them (editing a template's roles, §13.3.6b, is not built yet). */}
                <Input
                  id="tt-role"
                  value={form.roleHint}
                  onChange={(e) => set('roleHint', e.target.value)}
                  placeholder="Optional"
                />
                <p className="text-muted-foreground text-xs">
                  This template declares no roles, so type one.
                </p>
              </>
            )}
          </Field>

          <Field id="tt-priority" label="Priority">
            <Select
              value={form.priority}
              onValueChange={(v: string | null) => set('priority', (v ?? 'medium') as TaskPriority)}
            >
              <SelectTrigger id="tt-priority" className="w-full">
                <SelectValue>
                  {(v: string | null) => PRIORITY_LABELS[(v ?? 'medium') as TaskPriority]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {taskPriority.enumValues.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* Due-rule editor (Amendment D): exactly three kinds. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tt-due-kind" label="Due rule">
            <Select
              value={form.dueKind}
              onValueChange={(v: string | null) => set('dueKind', (v ?? 'day') as DueKind)}
            >
              <SelectTrigger id="tt-due-kind" className="w-full">
                <SelectValue>{(v: string | null) => DUE_KIND_LABELS[(v ?? 'day') as DueKind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DUE_KIND_LABELS) as DueKind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {DUE_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.dueKind === 'after' ? (
            <Field id="tt-due-ref" label="After task" error={errors.dueRef}>
              <Select
                value={form.dueRef || null}
                onValueChange={(v: string | null) => set('dueRef', v ?? '')}
              >
                <SelectTrigger id="tt-due-ref" className="w-full">
                  <SelectValue>
                    {(v: string | null) =>
                      v === null
                        ? 'Pick a task'
                        : (dependencyOptions.find((o) => o.id === v)?.label ?? 'A deleted task')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {dependencyOptions.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1.5 text-xs">
                      There are no other tasks in this template yet.
                    </p>
                  ) : (
                    dependencyOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              id="tt-due-n"
              label={form.dueKind === 'day' ? 'Day of the month' : 'Days before deadline'}
              error={errors.dueN}
            >
              <Input
                id="tt-due-n"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={form.dueN}
                onChange={(e) => set('dueN', e.target.value)}
                aria-invalid={errors.dueN ? true : undefined}
              />
            </Field>
          )}
        </div>

        <Field id="tt-est" label="Estimate (hours)" error={errors.estHours}>
          {/* Plain decimal hours: the repo has `fmtHM` for display but no HMInput (§3.2). */}
          <Input
            id="tt-est"
            type="number"
            min={0}
            step={0.25}
            inputMode="decimal"
            value={form.estHours}
            onChange={(e) => set('estHours', e.target.value)}
            placeholder="Optional, for example 1.5"
            aria-invalid={errors.estHours ? true : undefined}
          />
        </Field>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Check label="QC required" checked={form.qcRequired} onChange={(v) => set('qcRequired', v)} />
          <Check
            label="Proof required"
            checked={form.proofRequired}
            onChange={(v) => set('proofRequired', v)}
          />
          <Check
            label="Client visible"
            checked={form.clientVisible}
            onChange={(v) => set('clientVisible', v)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tt-sop" label="SOP link">
            <Input
              id="tt-sop"
              value={form.sopUrl}
              onChange={(e) => set('sopUrl', e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field id="tt-output" label="Expected output">
            <Input
              id="tt-output"
              value={form.expectedOutput}
              onChange={(e) => set('expectedOutput', e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        <Field id="tt-checklist" label="Checklist">
          <Textarea
            id="tt-checklist"
            value={form.checklist}
            onChange={(e) => set('checklist', e.target.value)}
            placeholder="One item per line"
            rows={3}
          />
        </Field>

        {/* Subtasks panel (§14.4.4): the live list, saved with the task. */}
        <section className="grid gap-2 rounded-md border p-3" aria-labelledby="tt-subtasks-heading">
          <h4 id="tt-subtasks-heading" className="text-xs font-medium">
            Subtasks ({form.subtasks.length})
          </h4>
          {form.subtasks.length > 0 ? (
            <ol className="grid gap-1">
              {form.subtasks.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">└ {i + 1}</span>
                  <span className="flex-1">{s.title}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeSubtask(s.key)}
                    aria-label={`Remove subtask ${s.title}`}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex gap-2">
            <Input
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                // Enter appends a subtask; it must not submit the whole task form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  appendSubtask();
                }
              }}
              placeholder="New subtask title…"
              aria-label="New subtask title"
            />
            <Button type="button" variant="outline" size="sm" onClick={appendSubtask}>
              + Create subtask
            </Button>
          </div>
        </section>
      </div>

      <DialogFooter className="sm:justify-between">
        <div>
          {task ? (
            <ConfirmDeleteButton
              label={`Delete ${task.title}`}
              description={`Remove ${task.title} and its subtasks?`}
              confirmLabel="Delete task"
              onConfirm={onDelete}
              trigger={
                <Button type="button" variant="destructive">
                  Delete task
                </Button>
              }
            />
          ) : null}
        </div>
        <div className="flex gap-2">
          <DialogClose
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : task ? 'Save task' : 'Add task'}
          </Button>
        </div>
      </DialogFooter>
    </form>
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

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
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
