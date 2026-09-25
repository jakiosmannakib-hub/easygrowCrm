// features/templates/components/add-month-wizard.tsx — PUL-504, §14.4.3
//
// The Add Month wizard: a 3-step modal that creates a whole 12-month cycle in one save.
//   1. Set month & date: the start month/day, with a live 12-month cascade preview.
//   2. Add categories: Month 1's categories.
//   3. Add tasks & subtasks: Month 1's tasks per category, each with its subtasks.
// Save calls §13.3.7a `createTemplateMonths`: Month 1 fully populated, Months 2–12 as empty
// scaffolds with cascaded dates.
//
// ── State ────────────────────────────────────────────────────────────────────────────────
// Everything the wizard holds is ONE object declared upfront (§16.10): no lazy initialisers, no
// `window.*` globals (the prototype's `window._mwiz` is exactly what this replaces). The body is
// rendered only while the dialog is open, so MOUNTING IS THE RESET: every open starts from
// `initialState()`. The dialog has its own `DialogTrigger`, so Base UI reports the open itself
// and there is no controlled-dialog trap; there is also no on-open fetch.
//
// Not optimistic: Save awaits the server, then toasts and hands over to `onSuccess`, which
// refreshes the tree. Errors go through `showErrorToast`.

'use client';

import { CheckIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { taskPriority } from '@/db/schema/enums';
import { PRIORITY_LABELS, categoryDotClass } from '@/features/projects/display';
import { showErrorToast } from '@/lib/show-error-toast';
import { cn } from '@/lib/utils';
import { createTemplateMonths } from '../actions';
import { cascadeMonthDates, daysInMonth, MONTH_NAMES } from '../cascade';
import type { TaskPriority } from '../task-form';

// ── Types and state ─────────────────────────────────────────────────────────────────────

type WizardRuleKind = 'day' | 'before_deadline';

interface WizardTask {
  tempId: string;
  title: string;
  /** `''` = no role. */
  roleHint: string;
  priority: TaskPriority;
  estHours: number | null;
  dueRule: { kind: WizardRuleKind; n: number };
  qcRequired: boolean;
  proofRequired: boolean;
  subtasks: string[];
}

/** The quick-add panel's inputs, as typed. */
interface TaskDraft {
  title: string;
  roleHint: string;
  priority: TaskPriority;
  estHours: string;
  dueKind: WizardRuleKind;
  dueN: string;
  qcRequired: boolean;
  proofRequired: boolean;
}

interface WizardState {
  step: 1 | 2 | 3;
  startMonth: number;
  startDay: number;
  /** Month 1's category names, in order. Unique (case-insensitive). */
  cats: string[];
  /** Tasks per category name. */
  pendingTasks: Record<string, WizardTask[]>;
  /** The category tab shown in step 3. */
  activeTab: string;
  saving: boolean;
  /** Step 2's "add category" input. */
  newCategory: string;
  /** Step 3's quick-add panel. */
  draft: TaskDraft;
  /** Step 3's quick-add title error, if any. */
  draftError: string | null;
  /** Each task card's "Add subtask…" input, by task tempId. */
  subtaskDrafts: Record<string, string>;
  /** Source of `tempId`s for this session's tasks. */
  nextTempId: number;
}

const EMPTY_DRAFT: TaskDraft = {
  title: '',
  roleHint: '',
  priority: 'medium',
  estHours: '2',
  dueKind: 'day',
  dueN: '1',
  qcRequired: true,
  proofRequired: false,
};

function initialState(): WizardState {
  return {
    step: 1,
    startMonth: 0,
    startDay: 1,
    cats: [],
    pendingTasks: {},
    activeTab: '',
    saving: false,
    newCategory: '',
    draft: EMPTY_DRAFT,
    draftError: null,
    subtaskDrafts: {},
    nextTempId: 1,
  };
}

/** Month 1 category presets (the prototype's `TEMPLATE_CATS_DEFAULT`, §14.4.5 "preset datalist"). */
const CATEGORY_PRESETS = [
  'On-page SEO',
  'Content',
  'Link Building',
  'Technical',
  'Reporting',
  'Design',
];

const STEP_LABELS = ['Set month & date', 'Add categories', 'Add tasks & subtasks'] as const;

/** The Select's "no role" value. Base UI Select values are strings. */
const NO_ROLE = '__none__';

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function rulePill(rule: WizardTask['dueRule']) {
  return rule.kind === 'day' ? `Day ${rule.n}` : `${rule.n}d before deadline`;
}

// ── Component ───────────────────────────────────────────────────────────────────────────

export function AddMonthWizard({
  templateId,
  templateRoles,
  onSuccess,
}: {
  templateId: string;
  /** `templates.roles`, the role palette (§3.3.5). */
  templateRoles: string[];
  /** Called after a successful save; the caller refreshes the tree. */
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger render={<Button size="sm">+ Add month</Button>} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <WizardBody
            templateId={templateId}
            templateRoles={templateRoles}
            onDone={() => {
              setOpen(false);
              onSuccess();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WizardBody({
  templateId,
  templateRoles,
  onDone,
}: {
  templateId: string;
  templateRoles: string[];
  onDone: () => void;
}) {
  const [s, setS] = useState<WizardState>(initialState);

  function patch(next: Partial<WizardState>) {
    setS((prev) => ({ ...prev, ...next }));
  }

  function setDraft<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setS((prev) => ({ ...prev, draft: { ...prev.draft, [key]: value }, draftError: null }));
  }

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  function setStartMonth(month: number) {
    // Clamp the day down when the new month is shorter (Jan 31 → Feb 29).
    setS((prev) => ({ ...prev, startMonth: month, startDay: Math.min(prev.startDay, daysInMonth(month)) }));
  }

  const cascade = cascadeMonthDates(s.startMonth, s.startDay);

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  function addCategory() {
    const name = s.newCategory.trim();
    if (!name) return;
    if (s.cats.some((c) => c.toLowerCase() === name.toLowerCase())) {
      toast('That category already exists.');
      return;
    }
    setS((prev) => ({
      ...prev,
      cats: [...prev.cats, name],
      pendingTasks: { ...prev.pendingTasks, [name]: [] },
      activeTab: prev.activeTab || name,
      newCategory: '',
    }));
  }

  function removeCategory(name: string) {
    setS((prev) => {
      const cats = prev.cats.filter((c) => c !== name);
      const pendingTasks = { ...prev.pendingTasks };
      delete pendingTasks[name];
      return {
        ...prev,
        cats,
        pendingTasks,
        activeTab: prev.activeTab === name ? (cats[0] ?? '') : prev.activeTab,
      };
    });
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  const activeTab = s.cats.includes(s.activeTab) ? s.activeTab : (s.cats[0] ?? '');
  const activeTasks = s.pendingTasks[activeTab] ?? [];

  function addTask() {
    const d = s.draft;
    const title = d.title.trim();
    if (!title) {
      patch({ draftError: 'Give the task a title.' });
      return;
    }
    const n = Number(d.dueN);
    if (d.dueN.trim() === '' || !Number.isInteger(n) || n < 0) {
      patch({ draftError: 'The due rule needs a whole number of days, 0 or more.' });
      return;
    }
    const hours = d.estHours.trim() === '' ? null : Number(d.estHours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
      patch({ draftError: 'Enter the estimate as a number of hours, for example 1.5.' });
      return;
    }

    setS((prev) => {
      const task: WizardTask = {
        tempId: `wt-${prev.nextTempId}`,
        title,
        roleHint: d.roleHint.trim(),
        priority: d.priority,
        estHours: hours,
        dueRule: { kind: d.dueKind, n },
        qcRequired: d.qcRequired,
        proofRequired: d.proofRequired,
        subtasks: [],
      };
      return {
        ...prev,
        pendingTasks: {
          ...prev.pendingTasks,
          [activeTab]: [...(prev.pendingTasks[activeTab] ?? []), task],
        },
        nextTempId: prev.nextTempId + 1,
        draft: EMPTY_DRAFT,
        draftError: null,
      };
    });
  }

  function updateTasks(category: string, fn: (tasks: WizardTask[]) => WizardTask[]) {
    setS((prev) => ({
      ...prev,
      pendingTasks: { ...prev.pendingTasks, [category]: fn(prev.pendingTasks[category] ?? []) },
    }));
  }

  function addSubtask(tempId: string) {
    const title = (s.subtaskDrafts[tempId] ?? '').trim();
    if (!title) return;
    updateTasks(activeTab, (tasks) =>
      tasks.map((t) => (t.tempId === tempId ? { ...t, subtasks: [...t.subtasks, title] } : t)),
    );
    setS((prev) => ({ ...prev, subtaskDrafts: { ...prev.subtaskDrafts, [tempId]: '' } }));
  }

  const allTasks = s.cats.flatMap((c) => s.pendingTasks[c] ?? []);
  const taskCount = allTasks.length;
  const subtaskCount = allTasks.reduce((n, t) => n + t.subtasks.length, 0);

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    patch({ saving: true });
    const result = await createTemplateMonths({
      templateId,
      startMonth: s.startMonth,
      startDay: s.startDay,
      month1: {
        cats: s.cats.map((name) => ({
          name,
          tasks: (s.pendingTasks[name] ?? []).map((t) => ({
            title: t.title,
            roleHint: t.roleHint || undefined,
            priority: t.priority,
            estHours: t.estHours ?? undefined,
            dueRule: t.dueRule,
            qcRequired: t.qcRequired,
            proofRequired: t.proofRequired,
            subtasks: t.subtasks,
          })),
        })),
      },
    });

    if (!result.ok) {
      showErrorToast(result);
      patch({ saving: false });
      return;
    }

    const n = result.data.firstNum;
    toast.success(
      `All 12 months created. Month ${n} has ${plural(s.cats.length, 'category', 'categories')}, ` +
        `${plural(result.data.month1Tasks, 'task', 'tasks')}, ` +
        `${plural(result.data.month1Subtasks, 'subtask', 'subtasks')}. ` +
        `Months ${n + 1}-${n + 11} are empty scaffolds.`,
    );
    onDone();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add month</DialogTitle>
        <DialogDescription>Creates a full 12-month cycle in one save.</DialogDescription>
      </DialogHeader>

      <StepIndicator step={s.step} />

      {s.step === 1 ? (
        <div className="grid gap-3">
          <p className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-200">
            Pick a start month and day. All 12 months will be created at once so you never have to
            make them again. You&apos;ll only fill out categories and tasks for Month 1 here.
            Months 2-12 stay empty until you open them.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="amw-month">Start month</Label>
              <Select
                value={String(s.startMonth)}
                onValueChange={(v: string | null) => setStartMonth(Number(v ?? 0))}
              >
                <SelectTrigger id="amw-month" className="w-full">
                  <SelectValue>
                    {(v: string | null) => MONTH_NAMES[Number(v ?? 0)] ?? MONTH_NAMES[0]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="amw-day">Start day</Label>
              <Select
                value={String(s.startDay)}
                onValueChange={(v: string | null) => patch({ startDay: Number(v ?? 1) })}
              >
                <SelectTrigger id="amw-day" className="w-full">
                  <SelectValue>{(v: string | null) => v ?? '1'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: daysInMonth(s.startMonth) }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ol className="grid max-h-[280px] gap-1 overflow-y-auto rounded-md border p-2">
            {cascade.map((start, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1">
                  Month {i + 1} - {MONTH_NAMES[start.month]} {start.day}
                </span>
                {i === 0 ? (
                  <Badge>Filling out now</Badge>
                ) : (
                  <Badge variant="outline">Auto-created</Badge>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {s.step === 2 ? (
        <div className="grid gap-3">
          <p className="text-xs">
            Setting up <span className="font-medium">Month 1</span> ({MONTH_NAMES[s.startMonth]}{' '}
            {s.startDay}). Add the categories its tasks will be grouped under.
          </p>

          {s.cats.length > 0 ? (
            <ul className="grid gap-1">
              {s.cats.map((name) => (
                <li key={name} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                  <span className={cn('size-2 rounded-full', categoryDotClass(name))} aria-hidden />
                  <span className="flex-1">{name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeCategory(name)}
                    aria-label={`Remove category ${name}`}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">No categories yet. Add at least one.</p>
          )}

          <div className="flex gap-2">
            <Input
              value={s.newCategory}
              onChange={(e) => patch({ newCategory: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCategory();
                }
              }}
              list="amw-category-presets"
              placeholder="Category name"
              aria-label="Category name"
            />
            <datalist id="amw-category-presets">
              {CATEGORY_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Button type="button" variant="outline" size="sm" onClick={addCategory}>
              + Add
            </Button>
          </div>
        </div>
      ) : null}

      {s.step === 3 ? (
        <div className="grid gap-3">
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Month 1 categories">
            {s.cats.map((name) => (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={name === activeTab ? 'default' : 'outline'}
                role="tab"
                aria-selected={name === activeTab}
                onClick={() => patch({ activeTab: name })}
              >
                {name} ({(s.pendingTasks[name] ?? []).length})
              </Button>
            ))}
          </div>

          {/* Task cards for the active category */}
          {activeTasks.length > 0 ? (
            <ol className="grid gap-2">
              {activeTasks.map((t, i) => (
                <li key={t.tempId} className="grid gap-1.5 rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground tabular-nums">#{i + 1}</span>
                    <span className="font-medium">{t.title}</span>
                    <span className="text-muted-foreground">· {t.roleHint || 'No role'}</span>
                    <Badge variant="outline">{rulePill(t.dueRule)}</Badge>
                    {t.qcRequired ? <Badge variant="secondary">QC</Badge> : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto"
                      onClick={() =>
                        updateTasks(activeTab, (tasks) => tasks.filter((x) => x.tempId !== t.tempId))
                      }
                      aria-label={`Remove task ${t.title}`}
                    >
                      <XIcon />
                    </Button>
                  </div>

                  {t.subtasks.length > 0 ? (
                    <ul className="grid gap-0.5 pl-4">
                      {t.subtasks.map((sub, j) => (
                        <li key={`${j}-${sub}`} className="text-muted-foreground flex items-center gap-1 text-xs">
                          <span>
                            └ {j + 1}. {sub}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              updateTasks(activeTab, (tasks) =>
                                tasks.map((x) =>
                                  x.tempId === t.tempId
                                    ? { ...x, subtasks: x.subtasks.filter((_, k) => k !== j) }
                                    : x,
                                ),
                              )
                            }
                            aria-label={`Remove subtask ${sub}`}
                          >
                            <XIcon />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="flex gap-2 pl-4">
                    <Input
                      value={s.subtaskDrafts[t.tempId] ?? ''}
                      onChange={(e) =>
                        patch({ subtaskDrafts: { ...s.subtaskDrafts, [t.tempId]: e.target.value } })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSubtask(t.tempId);
                        }
                      }}
                      placeholder="Add subtask..."
                      aria-label={`Add subtask to ${t.title}`}
                      className="h-6"
                    />
                    <Button type="button" variant="outline" size="xs" onClick={() => addSubtask(t.tempId)}>
                      + Subtask
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-xs">No tasks in {activeTab} yet.</p>
          )}

          {/* Quick-add panel */}
          <div className="grid gap-2 rounded-md border border-dashed p-3">
            <p className="text-xs font-medium">Add a task to {activeTab}</p>
            <Input
              value={s.draft.title}
              onChange={(e) => setDraft('title', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTask();
                }
              }}
              placeholder="Task title"
              aria-label="Task title"
              aria-invalid={s.draftError ? true : undefined}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              {templateRoles.length > 0 ? (
                <Select
                  value={s.draft.roleHint || NO_ROLE}
                  onValueChange={(v: string | null) =>
                    setDraft('roleHint', v === null || v === NO_ROLE ? '' : v)
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Role">
                    <SelectValue>
                      {(v: string | null) => (v === null || v === NO_ROLE ? 'No role' : v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ROLE}>No role</SelectItem>
                    {templateRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={s.draft.roleHint}
                  onChange={(e) => setDraft('roleHint', e.target.value)}
                  placeholder="Role (optional)"
                  aria-label="Role"
                />
              )}

              <Select
                value={s.draft.priority}
                onValueChange={(v: string | null) =>
                  setDraft('priority', (v ?? 'medium') as TaskPriority)
                }
              >
                <SelectTrigger className="w-full" aria-label="Priority">
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

              <Input
                type="number"
                min={0}
                step={0.25}
                inputMode="decimal"
                value={s.draft.estHours}
                onChange={(e) => setDraft('estHours', e.target.value)}
                placeholder="Est. hours"
                aria-label="Estimate in hours"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
              <Select
                value={s.draft.dueKind}
                onValueChange={(v: string | null) =>
                  setDraft('dueKind', (v ?? 'day') as WizardRuleKind)
                }
              >
                <SelectTrigger className="w-full" aria-label="Due rule">
                  <SelectValue>
                    {(v: string | null) =>
                      v === 'before_deadline' ? 'N days before deadline' : 'Day N'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day N</SelectItem>
                  <SelectItem value="before_deadline">N days before deadline</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={s.draft.dueN}
                onChange={(e) => setDraft('dueN', e.target.value)}
                aria-label="Due rule days"
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={s.draft.qcRequired}
                  onChange={(e) => setDraft('qcRequired', e.target.checked)}
                  className="size-3.5"
                />
                QC gate
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={s.draft.proofRequired}
                  onChange={(e) => setDraft('proofRequired', e.target.checked)}
                  className="size-3.5"
                />
                Proof required
              </label>
              <Button type="button" size="sm" className="ml-auto" onClick={addTask}>
                + Add task
              </Button>
            </div>
            {s.draftError ? <p className="text-destructive text-xs">{s.draftError}</p> : null}
          </div>

          <p className="bg-muted rounded-md p-2 text-xs">
            {plural(taskCount, 'task', 'tasks')} · {plural(subtaskCount, 'subtask', 'subtasks')} ·{' '}
            {plural(s.cats.length, 'category', 'categories')}
            {taskCount === 0 ? ' - you can add tasks after saving too' : ''}
          </p>
        </div>
      ) : null}

      <DialogFooter>
        {s.step > 1 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => patch({ step: (s.step - 1) as WizardState['step'] })}
            disabled={s.saving}
          >
            Back
          </Button>
        ) : null}
        <DialogClose
          render={
            <Button variant="outline" type="button" disabled={s.saving}>
              Cancel
            </Button>
          }
        />
        {s.step === 1 ? (
          <Button type="button" onClick={() => patch({ step: 2 })}>
            Next: Set up Month 1
          </Button>
        ) : null}
        {s.step === 2 ? (
          <Button
            type="button"
            onClick={() => patch({ step: 3, activeTab: activeTab || (s.cats[0] ?? '') })}
            disabled={s.cats.length === 0}
          >
            Next: Add tasks
          </Button>
        ) : null}
        {s.step === 3 ? (
          <Button type="button" onClick={save} disabled={s.saving}>
            {s.saving
              ? 'Saving…'
              : taskCount > 0
                ? `Save month (${plural(taskCount, 'task', 'tasks')})`
                : 'Save month'}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  );
}

/** Three numbered steps: done = check, current = brand, future = muted. */
function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Wizard steps">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'future';
        return (
          <li
            key={label}
            className="flex items-center gap-1.5 text-xs"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[0.625rem] font-medium',
                state === 'done' && 'bg-primary/15 text-primary',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'future' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <CheckIcon className="size-3" /> : n}
            </span>
            <span className={cn(state === 'future' && 'text-muted-foreground')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
