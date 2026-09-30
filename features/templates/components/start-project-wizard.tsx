// features/templates/components/start-project-wizard.tsx — PUL-506 Stage 2, §14.3.8
//
// The Start Project wizard: a 4-step modal that turns a template into a live project.
//   1. Choose client, then one of its accounts (Amendment M), and the project name.
//   2. Set dates: start date and an optional deadline.
//   3. Assign team members to roles: one row per role the template's tasks use.
//   4. Preview: every task that will be generated, read-only.
// "Generate project" calls §13.3.2 `createProjectFromTemplate` (Stage 1).
//
// ── State ────────────────────────────────────────────────────────────────────────────────
// Same discipline as the Add Month wizard: ONE state object declared upfront (§16.10), the body
// rendered only while the dialog is open so MOUNTING IS THE RESET, and a `DialogTrigger` rather
// than an externally controlled `open`. There is no on-open fetch: the page hands down the
// template, clients, accounts and assignable users.
//
// ── Preview dates ────────────────────────────────────────────────────────────────────────
// Computed here with `computeDueDates` (PUL-505) and an EMPTY holidays set, exactly as the action
// does until the holidays table exists (PUL-301). Same function, same inputs, so the preview and
// the generated dates always match. Titles go through `projectTaskTitle`, the helper the action
// itself uses.
//
// Not optimistic (an accountability action): Generate awaits the server, then toasts and opens
// the new project. Errors go through `showErrorToast`.

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { createProjectFromTemplate } from '@/features/projects/actions';
import { dhakaToday, fmtDate } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { computeDueDates } from '../due-rule-compute';
import { projectTaskTitle, type StartProjectTask, type StartProjectTemplate } from '../start-project';
import { formatTemplateMeta } from '../template-meta';
import { StepIndicator } from './step-indicator';

// ── Types and state ─────────────────────────────────────────────────────────────────────

/** A dropdown option: a client, or a user who can hold tasks (active, not SA). */
export interface PickOption {
  id: string;
  name: string;
}

/** An account option: a live account of a live client (`activeAccountsQuery`). */
export interface AccountOption {
  id: string;
  clientId: string;
  name: string;
}

interface WizardState {
  step: 1 | 2 | 3 | 4;
  /** `''` until a client is picked. Only narrows Account ▾; the project is written to the account. */
  clientId: string;
  /** `''` until an account is picked. Cleared whenever the client changes. */
  accountId: string;
  name: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`, or `''` for no deadline. */
  deadline: string;
  /** Role → user id, or `UNASSIGNED`. One key per template role, from the first render. */
  assignments: Record<string, string>;
  /** The current step's validation message, if Next was refused. */
  stepError: string | null;
  saving: boolean;
}

/** Step 3's "Unassigned" option. Base UI Select values are strings; no user id collides. */
const UNASSIGNED = '__unassigned__';

/** No holidays table yet (PUL-301): the action uses an empty set too. */
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

const STEP_LABELS = ['Client & account', 'Dates', 'Assign roles', 'Preview'] as const;

function initialState(template: StartProjectTemplate): WizardState {
  return {
    step: 1,
    clientId: '',
    accountId: '',
    // §14.3.8 step 1: defaults to the template name, editable.
    name: template.name,
    startDate: dhakaToday(),
    deadline: '',
    assignments: Object.fromEntries(template.roles.map((role) => [role, UNASSIGNED])),
    stepError: null,
    saving: false,
  };
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The due-rule pill: `Day 3`, `2d before deadline`, `After #4`. */
function rulePill(task: StartProjectTask, indexById: Map<string, number>): string {
  const rule = task.dueRule;
  if (rule.kind === 'day') return `Day ${Math.max(rule.n, 1)}`;
  if (rule.kind === 'before_deadline') return rule.n === 0 ? 'On deadline' : `${rule.n}d before deadline`;
  const ref = indexById.get(rule.ref);
  return ref === undefined ? 'After a missing task' : `After #${ref + 1}`;
}

// ── Component ───────────────────────────────────────────────────────────────────────────

export function StartProjectWizard({
  template,
  clients,
  accounts,
  assignees,
}: {
  template: StartProjectTemplate;
  /** Active (non-archived) clients. */
  clients: PickOption[];
  /** Live accounts of live clients. */
  accounts: AccountOption[];
  /** Active, non-SA users: who may hold a task. */
  assignees: PickOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger render={<Button size="sm">Start Project</Button>} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <WizardBody
            template={template}
            clients={clients}
            accounts={accounts}
            assignees={assignees}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WizardBody({
  template,
  clients,
  accounts,
  assignees,
}: {
  template: StartProjectTemplate;
  clients: PickOption[];
  accounts: AccountOption[];
  assignees: PickOption[];
}) {
  const router = useRouter();
  const [s, setS] = useState<WizardState>(() => initialState(template));

  function patch(next: Partial<WizardState>) {
    setS((prev) => ({ ...prev, ...next, stepError: null }));
  }

  const clientName = clients.find((c) => c.id === s.clientId)?.name ?? '';
  const clientAccounts = accounts.filter((a) => a.clientId === s.clientId);
  const accountName = clientAccounts.find((a) => a.id === s.accountId)?.name ?? '';
  const needsDeadline = template.tasks.some((t) => t.dueRule.kind === 'before_deadline');
  const unroledCount = template.tasks.filter((t) => t.roleHint === null).length;

  // ── Step navigation ────────────────────────────────────────────────────────
  function next() {
    if (s.step === 1) {
      if (!s.clientId) return setS((p) => ({ ...p, stepError: 'Pick a client.' }));
      if (!s.accountId) return setS((p) => ({ ...p, stepError: 'Pick an account.' }));
      if (!s.name.trim()) return setS((p) => ({ ...p, stepError: 'Give the project a name.' }));
    }
    if (s.step === 2) {
      if (!s.startDate) return setS((p) => ({ ...p, stepError: 'Pick a start date.' }));
      if (s.deadline && s.deadline < s.startDate) {
        return setS((p) => ({ ...p, stepError: 'The deadline must be on or after the start date.' }));
      }
      if (needsDeadline && !s.deadline) {
        return setS((p) => ({
          ...p,
          stepError: 'This template has tasks due before the deadline. Set a deadline.',
        }));
      }
    }
    setS((p) => ({ ...p, step: (p.step + 1) as WizardState['step'], stepError: null }));
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  const indexById = new Map(template.tasks.map((t, i) => [t.id, i]));
  const preview =
    s.step === 4
      ? computeDueDates(
          template.tasks.map((t) => ({ id: t.id, dueRule: t.dueRule, _monthNum: t.monthNum })),
          { startDate: s.startDate, deadline: s.deadline || null, holidays: NO_HOLIDAYS },
        )
      : null;
  const previewMonths = new Set(template.tasks.map((t) => t.monthNum)).size;

  // ── Generate ───────────────────────────────────────────────────────────────
  async function generate() {
    setS((p) => ({ ...p, saving: true }));
    const name = s.name.trim();
    const result = await createProjectFromTemplate({
      templateId: template.id,
      accountId: s.accountId,
      name,
      startDate: s.startDate,
      deadline: s.deadline || undefined,
      assignments: Object.fromEntries(
        Object.entries(s.assignments).map(([role, id]) => [role, id === UNASSIGNED ? null : id]),
      ),
    });

    if (!result.ok) {
      showErrorToast(result);
      setS((p) => ({ ...p, saving: false }));
      return;
    }

    const { projectId, taskCount, monthCount } = result.data;
    toast.success(
      `'${name}' created. ${plural(taskCount, 'task', 'tasks')} generated across ` +
        `${plural(monthCount, 'month', 'months')}. Opening now.`,
    );
    // §14.3.8: the new project, List tab, month filter cleared (the page starts at all months).
    router.push(`/projects?project=${encodeURIComponent(projectId)}&tab=list`);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Start project from {template.name}</DialogTitle>
        <DialogDescription>{formatTemplateMeta(template.meta)} will be generated.</DialogDescription>
      </DialogHeader>

      <StepIndicator labels={STEP_LABELS} step={s.step} />

      {s.step === 1 ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="spw-client">Client</Label>
            <Select
              value={s.clientId || null}
              // A new client invalidates the picked account: it belonged to the old one.
              onValueChange={(v: string | null) => patch({ clientId: v ?? '', accountId: '' })}
            >
              <SelectTrigger id="spw-client" className="w-full">
                {/* The children function maps the id to a name (see new-task-modal.tsx). */}
                <SelectValue>
                  {(v: string | null) =>
                    (v && clients.find((c) => c.id === v)?.name) || 'Choose a client'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clients.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No active clients. Add one on the{' '}
                <Link href="/clients" className="text-foreground underline underline-offset-2">
                  Clients page
                </Link>{' '}
                first.
              </p>
            ) : null}
          </div>

          {/* Amendment M: the project belongs to one of the client's accounts (its end business). */}
          <div className="grid gap-1.5">
            <Label htmlFor="spw-account">Account</Label>
            <Select
              value={s.accountId || null}
              onValueChange={(v: string | null) => patch({ accountId: v ?? '' })}
              disabled={!s.clientId || clientAccounts.length === 0}
            >
              <SelectTrigger id="spw-account" className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    (v && clientAccounts.find((a) => a.id === v)?.name) ||
                    (s.clientId ? 'Choose an account' : 'Choose a client first')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clientAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {s.clientId && clientAccounts.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {clientName} has no active accounts. Add one on the{' '}
                <Link href="/clients" className="text-foreground underline underline-offset-2">
                  Clients page
                </Link>
                .
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="spw-name">Project name</Label>
            <Input
              id="spw-name"
              value={s.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      {s.step === 2 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="spw-start">Start date</Label>
            <Input
              id="spw-start"
              type="date"
              value={s.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              {s.startDate ? fmtDate(s.startDate, { relative: false }) : 'Not set'}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="spw-deadline">
              Deadline{needsDeadline ? '' : ' (optional)'}
            </Label>
            <Input
              id="spw-deadline"
              type="date"
              value={s.deadline}
              min={s.startDate || undefined}
              onChange={(e) => patch({ deadline: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              {s.deadline ? fmtDate(s.deadline, { relative: false }) : 'No deadline'}
            </p>
          </div>

          {needsDeadline ? (
            <p className="text-muted-foreground text-xs sm:col-span-2">
              Some tasks are due a set number of days before the deadline, so this template needs
              one.
            </p>
          ) : null}
        </div>
      ) : null}

      {s.step === 3 ? (
        <div className="grid gap-3">
          {template.roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No task in this template names a role, so every task starts unassigned.
            </p>
          ) : (
            <ul className="grid gap-2">
              {template.roles.map((role) => {
                const id = `spw-role-${role}`;
                const count = template.tasks.filter((t) => t.roleHint === role).length;
                return (
                  <li key={role} className="grid items-center gap-1.5 sm:grid-cols-[1fr_16rem]">
                    <Label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2">
                      {role}
                      <span className="text-muted-foreground text-xs font-normal">
                        {plural(count, 'task', 'tasks')}
                      </span>
                    </Label>
                    <Select
                      value={s.assignments[role] ?? UNASSIGNED}
                      onValueChange={(v: string | null) =>
                        patch({ assignments: { ...s.assignments, [role]: v ?? UNASSIGNED } })
                      }
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue>
                          {(v: string | null) =>
                            (v && v !== UNASSIGNED && assignees.find((u) => u.id === v)?.name) ||
                            'Unassigned'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {assignees.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            Unassigned tasks land in the Unassigned group, ready to hand out later.
            {unroledCount > 0
              ? ` ${plural(unroledCount, 'task has', 'tasks have')} no role and will start unassigned.`
              : ''}
          </p>
        </div>
      ) : null}

      {s.step === 4 ? (
        <div className="grid gap-2">
          <p className="bg-muted rounded-md p-2 text-xs">
            {plural(template.tasks.length, 'task', 'tasks')} across{' '}
            {plural(previewMonths, 'month', 'months')} for {accountName} ({clientName}), starting{' '}
            {fmtDate(s.startDate, { relative: false })}
            {s.deadline ? `, deadline ${fmtDate(s.deadline, { relative: false })}` : ''}.
          </p>
          {preview && !preview.ok ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
              {preview.reason === 'no_deadline'
                ? 'Some tasks need a deadline to get a due date.'
                : 'A task is scheduled after a task that is missing or in a loop.'}{' '}
              Due dates are not shown.
            </p>
          ) : null}
          <ol className="grid max-h-[50dvh] gap-1 overflow-y-auto rounded-md border p-2">
            {template.tasks.map((t, i) => {
              const due = preview?.ok ? preview.dates.get(t.id) : undefined;
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1.5 text-xs last:border-b-0"
                >
                  <span className="text-muted-foreground tabular-nums">#{i + 1}</span>
                  <span className="font-medium">
                    {projectTaskTitle(t.title, {
                      clientName,
                      accountName,
                      projectName: s.name.trim(),
                      startDate: s.startDate,
                      monthNum: t.monthNum,
                    })}
                  </span>
                  <span className="text-muted-foreground">· {t.category}</span>
                  <span className="text-muted-foreground">· {t.roleHint ?? 'No role'}</span>
                  <Badge variant="outline" className="font-normal">
                    {rulePill(t, indexById)}
                    {due ? ` · ${fmtDate(due, { relative: false })}` : ''}
                  </Badge>
                  {t.qcRequired ? <Badge variant="secondary">QC</Badge> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {s.stepError ? <p className="text-destructive text-xs">{s.stepError}</p> : null}

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
        {s.step < 4 ? (
          <Button type="button" onClick={next}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={generate} disabled={s.saving}>
            {s.saving ? 'Generating…' : 'Generate project'}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
