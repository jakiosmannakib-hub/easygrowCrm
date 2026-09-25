// features/templates/components/template-tree.tsx — PUL-503 Stage 3a, §14.4.2
//
// The template detail body: toolbar, then Month → Category → Task → Subtask.
//
// - Months and categories: inline add / rename / delete through the §13.3.7b–c actions (and the
//   PUL-503 `addTemplateMonth`).
// - Tasks: added and edited through the one Add/Edit Task modal (§14.4.4, Stage 3b), opened from a
//   category's Add task button or a task's title. Subtasks are edited only inside that modal; the
//   tree shows them read-only (§13.3.7e's inline subtask actions are not built).
// - `canEdit` (`template.update`, decided by the page) hides every edit affordance for HR, who
//   sees the tree read-only (§14.4.2, §9.6 ⁹). Presentation only: every action re-authorizes.
// - Not optimistic: each mutation awaits the server, then toasts and `router.refresh()`es, so
//   the tree on screen is always the tree the server returned. Errors, including
//   `GATE:task_has_dependents` from a month or category delete, go through `showErrorToast`.
// - Order is the data's order: `loadTemplateTree` returns every level sorted by `position`, and
//   nothing here re-sorts.

'use client';

import { CalendarIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PRIORITY_LABELS,
  PRIORITY_PILL_CLASSNAME,
  categoryDotClass,
} from '@/features/projects/display';
import type { ActionResult } from '@/lib/action-result';
import { fmtHM } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { cn } from '@/lib/utils';
import {
  addTemplateCategory,
  addTemplateMonth,
  deleteTemplateCategory,
  deleteTemplateMonth,
  renameTemplateCategory,
  renameTemplateMonth,
} from '../actions';
import { dueRuleSummary, hasTitleToken, monthStartLabel } from '../display';
import {
  tplAllTasks,
  type TemplateCategoryNode,
  type TemplateMonthNode,
  type TemplateTaskNode,
  type TemplateTree as Tree,
} from '../hierarchy';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { InlineNameForm } from './inline-name-form';
import { TaskModal, type DependencyOption, type TaskModalTarget } from './task-modal';

/**
 * Await an action, then report it: a failure goes through the PUL-106 mapper, a success toasts
 * and refreshes the server tree. Resolves whether it succeeded, so a form or dialog knows to close.
 */
function useSettle() {
  const router = useRouter();
  return async function settle<T>(
    pending: Promise<ActionResult<T>>,
    success: (data: T) => string,
  ): Promise<boolean> {
    const result = await pending;
    if (!result.ok) {
      showErrorToast(result);
      return false;
    }
    toast.success(success(result.data));
    router.refresh();
    return true;
  };
}

type Settle = ReturnType<typeof useSettle>;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function TemplateTree({ tree, canEdit }: { tree: Tree; canEdit: boolean }) {
  // ── Collapse state: DECLARED UPFRONT, in memory only (§503.5) ──────────────────────
  // A deliberate decision: no persistence, no URL params, no localStorage. The sets hold what is
  // COLLAPSED, so everything starts expanded (months included, as §503 asks), and a month or
  // category added later appears expanded without anyone seeding it. The state survives
  // `router.refresh()`, because refreshing re-renders this component rather than remounting it.
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [addingMonth, setAddingMonth] = useState(false);
  // The task modal's target (add into a category, or edit a task), also declared upfront.
  const [taskModal, setTaskModal] = useState<TaskModalTarget | null>(null);

  const settle = useSettle();

  // Every task's title by id, for `After "<title>"`: an `after` ref may point into any month.
  // The flat list is built by `tplAllTasks`, the only flattener (§16.7), and is never stored.
  const allTasks = useMemo(() => tplAllTasks(tree), [tree]);
  const titleById = useMemo(() => new Map(allTasks.map((t) => [t.id, t.title])), [allTasks]);
  // The after-rule picker: every task, labelled with where it lives, in walk order.
  const dependencyOptions = useMemo<DependencyOption[]>(
    () =>
      allTasks.map((t) => ({ id: t.id, label: `${t._monthName} › ${t._catName} › ${t.title}` })),
    [allTasks],
  );

  function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  async function onAddMonth() {
    setAddingMonth(true);
    try {
      await settle(addTemplateMonth({ templateId: tree.id }), (m) => `${m.name} added.`);
    } finally {
      setAddingMonth(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar (§14.4.2): month/task summary + Add month. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {plural(tree.months.length, 'month', 'months')} ·{' '}
          {plural(allTasks.length, 'task', 'tasks')}
        </p>
        {canEdit ? (
          <Button size="sm" onClick={onAddMonth} disabled={addingMonth}>
            {addingMonth ? 'Adding…' : '+ Add month'}
          </Button>
        ) : null}
      </div>

      {tree.months.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          No months yet.{canEdit ? ' Add the first one to start building this template.' : ''}
        </p>
      ) : (
        tree.months.map((month) => (
          <MonthSection
            key={month.id}
            month={month}
            open={!collapsedMonths.has(month.id)}
            onToggle={() => setCollapsedMonths((s) => toggle(s, month.id))}
            isCategoryOpen={(id) => !collapsedCategories.has(id)}
            onToggleCategory={(id) => setCollapsedCategories((s) => toggle(s, id))}
            titleById={titleById}
            canEdit={canEdit}
            settle={settle}
            onOpenTask={setTaskModal}
          />
        ))
      )}

      {canEdit ? (
        <TaskModal
          target={taskModal}
          onClose={() => setTaskModal(null)}
          rolePalette={tree.roles}
          dependencyOptions={dependencyOptions}
        />
      ) : null}
    </div>
  );
}

function MonthSection({
  month,
  open,
  onToggle,
  isCategoryOpen,
  onToggleCategory,
  titleById,
  canEdit,
  settle,
  onOpenTask,
}: {
  month: TemplateMonthNode;
  open: boolean;
  onToggle: () => void;
  isCategoryOpen: (categoryId: string) => boolean;
  onToggleCategory: (categoryId: string) => void;
  titleById: ReadonlyMap<string, string>;
  canEdit: boolean;
  settle: Settle;
  onOpenTask: (target: TaskModalTarget) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);

  const taskCount = month.categories.reduce((n, c) => n + c.tasks.length, 0);
  const bodyId = `month-body-${month.id}`;

  return (
    <section className="rounded-lg ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Collapse ${month.name}` : `Expand ${month.name}`}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <CalendarIcon className="text-muted-foreground size-4" aria-hidden />

        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineNameForm
              initial={month.name}
              label="Month name"
              submitLabel="Rename"
              onCancel={() => setRenaming(false)}
              onSave={async (name) => {
                const ok = await settle(
                  renameTemplateMonth({ monthId: month.id, name }),
                  () => 'Month renamed.',
                );
                if (ok) setRenaming(false);
                return ok;
              }}
            />
          ) : (
            <>
              <h3 className="font-heading text-sm font-medium">{month.name}</h3>
              <p className="text-muted-foreground text-xs">
                Month {month.num} · {monthStartLabel(month.startMonth, month.startDay)} ·{' '}
                {plural(taskCount, 'task', 'tasks')} ·{' '}
                {plural(month.categories.length, 'category', 'categories')}
              </p>
            </>
          )}
        </div>

        {canEdit && !renaming ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenaming(true)}
              aria-label={`Rename ${month.name}`}
            >
              <PencilIcon /> Rename
            </Button>
            <ConfirmDeleteButton
              label={`Delete ${month.name}`}
              description={`Remove ${month.name} and all its tasks?`}
              confirmLabel="Delete month"
              onConfirm={() =>
                settle(deleteTemplateMonth({ monthId: month.id }), () => `${month.name} deleted.`)
              }
            />
          </div>
        ) : null}
      </header>

      {open ? (
        <div id={bodyId} className="space-y-2 border-t px-3 py-3">
          {month.categories.length === 0 ? (
            <p className="text-muted-foreground text-xs">No categories in this month yet.</p>
          ) : (
            month.categories.map((category) => (
              <CategorySection
                key={category.id}
                category={category}
                open={isCategoryOpen(category.id)}
                onToggle={() => onToggleCategory(category.id)}
                titleById={titleById}
                canEdit={canEdit}
                settle={settle}
                onOpenTask={onOpenTask}
              />
            ))
          )}

          {canEdit ? (
            addingCategory ? (
              <InlineNameForm
                label="Category name"
                submitLabel="Add category"
                onCancel={() => setAddingCategory(false)}
                onSave={async (name) => {
                  const ok = await settle(
                    addTemplateCategory({ monthId: month.id, name }),
                    (c) => `${c.name} added.`,
                  );
                  if (ok) setAddingCategory(false);
                  return ok;
                }}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-dashed"
                onClick={() => setAddingCategory(true)}
              >
                + Add new category in {month.name}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CategorySection({
  category,
  open,
  onToggle,
  titleById,
  canEdit,
  settle,
  onOpenTask,
}: {
  category: TemplateCategoryNode;
  open: boolean;
  onToggle: () => void;
  titleById: ReadonlyMap<string, string>;
  canEdit: boolean;
  settle: Settle;
  onOpenTask: (target: TaskModalTarget) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const bodyId = `category-body-${category.id}`;

  return (
    <div className="rounded-md bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Collapse ${category.name}` : `Expand ${category.name}`}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <span className={cn('size-2 rounded-full', categoryDotClass(category.name))} aria-hidden />

        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineNameForm
              initial={category.name}
              label="Category name"
              submitLabel="Rename"
              onCancel={() => setRenaming(false)}
              onSave={async (name) => {
                const ok = await settle(
                  renameTemplateCategory({ categoryId: category.id, name }),
                  () => 'Category renamed.',
                );
                if (ok) setRenaming(false);
                return ok;
              }}
            />
          ) : (
            <p className="text-xs font-medium">
              {category.name}{' '}
              <span className="text-muted-foreground font-normal">
                · {plural(category.tasks.length, 'task', 'tasks')}
              </span>
            </p>
          )}
        </div>

        {canEdit && !renaming ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onOpenTask({ categoryId: category.id, categoryName: category.name, task: null })
              }
            >
              + Add task
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenaming(true)}
              aria-label={`Rename ${category.name}`}
            >
              <PencilIcon /> Rename
            </Button>
            <ConfirmDeleteButton
              label={`Delete ${category.name}`}
              description={`Remove ${category.name} and all its tasks?`}
              confirmLabel="Delete category"
              onConfirm={() =>
                settle(
                  deleteTemplateCategory({ categoryId: category.id }),
                  () => `${category.name} deleted.`,
                )
              }
            />
          </div>
        ) : null}
      </div>

      {open ? (
        <div id={bodyId} className="px-2 pb-2">
          {category.tasks.length === 0 ? (
            <p className="text-muted-foreground px-1 py-1 text-xs">No tasks in this category yet.</p>
          ) : (
            <>
              {/* Column header (§14.4.2), shown only where the row is laid out as columns. */}
              <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_8rem_11rem_5rem_4rem] gap-2 px-1 pb-1 text-[0.625rem] uppercase tracking-wide md:grid">
                <span>Task</span>
                <span>Role</span>
                <span>Due rule</span>
                <span>Priority</span>
                <span>Est</span>
              </div>
              <ol className="divide-y">
                {category.tasks.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={i + 1}
                    titleById={titleById}
                    onEdit={
                      canEdit
                        ? () =>
                            onOpenTask({ categoryId: category.id, categoryName: category.name, task })
                        : undefined
                    }
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One task row. `index` is the task's 1-based place in its category, which also numbers its
 * subtasks `└ N.M`. With `onEdit` (editors only) the title is a button that opens the task
 * modal; without it (HR) the row is read-only text.
 */
function TaskRow({
  task,
  index,
  titleById,
  onEdit,
}: {
  task: TemplateTaskNode;
  index: number;
  titleById: ReadonlyMap<string, string>;
  onEdit?: () => void;
}) {
  return (
    <li className="px-1 py-1.5">
      <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_8rem_11rem_5rem_4rem] md:items-center md:gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs tabular-nums">{index}.</span>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="focus-visible:ring-ring/30 rounded-sm text-left text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Edit ${task.title}`}
            >
              {task.title}
            </button>
          ) : (
            <span className="text-xs font-medium">{task.title}</span>
          )}
          {hasTitleToken(task.title) ? <Badge variant="outline">token</Badge> : null}
          {task.qcRequired ? <Badge variant="secondary">QC required</Badge> : null}
          {task.proofRequired ? <Badge variant="secondary">Proof required</Badge> : null}
          {task.clientVisible ? <Badge variant="secondary">Client visible</Badge> : null}
        </div>
        <span className="text-muted-foreground text-xs">
          <span className="md:hidden">Role: </span>
          {task.roleHint ?? 'No role'}
        </span>
        <span className="text-xs">
          <span className="text-muted-foreground md:hidden">Due: </span>
          {dueRuleSummary(task.dueRule, titleById)}
        </span>
        <span>
          <Badge variant="outline" className={PRIORITY_PILL_CLASSNAME[task.priority]}>
            {PRIORITY_LABELS[task.priority]}
          </Badge>
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {/* h+m everywhere (§3.2): fmtHM. A missing estimate stays blank. */}
          {task.estHours !== null ? fmtHM(Number(task.estHours)) : ''}
        </span>
      </div>

      {task.subtasks.length > 0 ? (
        <ul className="mt-1 space-y-0.5 pl-5">
          {task.subtasks.map((subtask, j) => (
            <li key={subtask.id} className="text-muted-foreground text-xs">
              └ {index}.{j + 1} {subtask.title}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
