// features/attendance/components/sign-in-dialog.tsx (PUL-302 Stage 2, §14.6.1 / §13.5.1)
//
// The Sign-In modal: work type, then today's plan (prefilled from my open tasks due today or
// overdue, plus ad-hoc rows), then Sign in. Not optimistic: signing in is an accountability
// action and waits for the server (§14.15 r.5).
//
// The payload is checked with the action's own `SignInInput` before the round trip; the action
// re-parses and is the gate. The Late note uses the same `isLateSignIn` rule the server applies,
// so the warning and the outcome cannot disagree (except across the minute boundary itself).

'use client';

import { XIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { HMInput } from '@/components/hm-input';
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
import type { PickableClient } from '@/features/clients/queries';
import { StatusPill } from '@/features/projects/components/status-pill';
import { PRIORITY_LABELS, type TaskPriority, type TaskStatus } from '@/features/projects/display';
import { clock } from '@/lib/clock';
import { fmtClockTime, fmtHM, localDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { signIn } from '../actions';
import {
  OVERDUE_PILL_CLASSNAME,
  WORK_TYPE_LABELS,
  type WorkType,
} from '../display';
import { isLateSignIn } from '../late';
import type { SignInPrefillRow } from '../queries';
import { MAX_PLAN_ROWS, SignInInput } from '../schema';

/** The settings the dialog needs: the late rule's inputs. */
export interface SignInRules {
  graceIn: string;
  workDays: number[];
  timezone: string;
}

export interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: SignInPrefillRow[];
  clients: PickableClient[];
  rules: SignInRules;
  /** Whether today (local) is in `holidays`, decided by the server page. */
  holidayToday: boolean;
}

export function SignInDialog({ open, onOpenChange, ...body }: SignInDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>Choose where you are working today and confirm your plan.</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening: MOUNTING IS THE RESET (see new-task-modal.tsx). */}
        {open ? <SignInBody {...body} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** A plan row being drafted. Linked rows carry their task; ad-hoc rows carry their fields. */
type PlanDraft =
  | {
      key: string;
      kind: 'linked';
      title: string;
      projectTaskId: string;
      projectName: string;
      status: TaskStatus;
      isOverdue: boolean;
    }
  | {
      key: string;
      kind: 'adhoc';
      title: string;
      clientId: string | null;
      clientName: string | null;
      category: string;
      priority: TaskPriority;
      estimatedHours: number | null;
      expectedOutput: string;
    };

/** The client select's "No client" item. Not an id, never submitted. */
const NO_CLIENT = 'none';

const EMPTY_DRAFT = {
  title: '',
  clientId: NO_CLIENT,
  category: '',
  priority: 'medium' as TaskPriority,
  estimatedHours: null as number | null,
  expectedOutput: '',
};

function SignInBody({
  prefill,
  clients,
  rules,
  holidayToday,
  onOpenChange,
}: Omit<SignInDialogProps, 'open'>) {
  const router = useRouter();
  const nextKey = useRef(0);
  const newKey = () => `row-${nextKey.current++}`;

  const [workType, setWorkType] = useState<WorkType>('in_office');
  const [rows, setRows] = useState<PlanDraft[]>(() =>
    prefill.map((t, i) => ({
      key: `prefill-${i}`,
      kind: 'linked',
      title: t.title,
      projectTaskId: t.id,
      projectName: t.projectName,
      status: t.status,
      isOverdue: t.isOverdue,
    })),
  );
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const lateNow = isLateSignIn(localDateTime(clock.now(), rules.timezone), rules, holidayToday);
  const full = rows.length >= MAX_PLAN_ROWS;
  const canAdd = draft.title.trim().length > 0 && !full;
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;

  function addRow() {
    if (!canAdd) return;
    const clientId = draft.clientId === NO_CLIENT ? null : draft.clientId;
    setRows((rs) => [
      ...rs,
      {
        key: newKey(),
        kind: 'adhoc',
        title: draft.title.trim(),
        clientId,
        clientName: clientName(clientId),
        category: draft.category.trim(),
        priority: draft.priority,
        estimatedHours: draft.estimatedHours,
        expectedOutput: draft.expectedOutput.trim(),
      },
    ]);
    setDraft(EMPTY_DRAFT);
  }

  async function submit() {
    setError(null);
    const parsed = SignInInput.safeParse({
      workType,
      plan: rows.map((r) =>
        r.kind === 'linked'
          ? { title: r.title, projectTaskId: r.projectTaskId }
          : {
              title: r.title,
              clientId: r.clientId ?? undefined,
              category: r.category || undefined,
              priority: r.priority,
              estimatedHours: r.estimatedHours ?? undefined,
              expectedOutput: r.expectedOutput || undefined,
            },
      ),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your plan and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(parsed.data);
      if (!result.ok) {
        if (result.code === 'CONFLICT') {
          // Signed in elsewhere (another tab, a double click that beat the button): the card is
          // stale, so close and re-read rather than leave the dialog asking again.
          toast.error("You're already signed in today.");
          onOpenChange(false);
          router.refresh();
          return;
        }
        setError(result.message);
        return;
      }
      toast.success(result.data.late ? 'Signed in. Today is marked Late.' : 'Signed in');
      onOpenChange(false);
      router.refresh();
    } catch {
      setError('Sign-in did not go through. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        {error ? (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {lateNow ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
            It&apos;s after {fmtClockTime(rules.graceIn)}, so today will show as Late.
          </p>
        ) : null}

        {/* Step 1: work type. Native radios, so arrow keys and screen readers work as-is. */}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Where are you working today?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(WORK_TYPE_LABELS) as WorkType[]).map((wt) => (
              <label
                key={wt}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium',
                  'has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-ring/50 has-focus-visible:ring-3',
                )}
              >
                <input
                  type="radio"
                  name="work-type"
                  value={wt}
                  checked={workType === wt}
                  onChange={() => setWorkType(wt)}
                  className="accent-primary size-4"
                />
                {WORK_TYPE_LABELS[wt]}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Step 2: the plan. */}
        <section className="space-y-2" aria-labelledby="plan-heading">
          <h3 id="plan-heading" className="text-sm font-medium">
            Today&apos;s plan <span className="text-muted-foreground font-normal">({rows.length})</span>
          </h3>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No tasks due today. Add what you plan to work on below, or sign in with an empty plan.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {rows.map((r) => (
                <li key={r.key} className="flex items-start gap-2 p-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm break-words">{r.title}</p>
                    <PlanRowMeta row={r} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label={`Remove "${r.title}" from the plan`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Add an ad-hoc row. */}
        <section className="space-y-3 rounded-lg border border-dashed p-3" aria-labelledby="add-heading">
          <h3 id="add-heading" className="text-sm font-medium">
            Add to the plan
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Title" htmlFor="si-title" className="sm:col-span-2">
              <Input
                id="si-title"
                value={draft.title}
                placeholder="What will you work on?"
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRow();
                  }
                }}
              />
            </Field>

            <Field label="Client" htmlFor="si-client">
              <Select
                value={draft.clientId}
                onValueChange={(v: string | null) =>
                  setDraft((d) => ({ ...d, clientId: v ?? NO_CLIENT }))
                }
              >
                <SelectTrigger id="si-client" className="w-full">
                  <SelectValue placeholder="Choose a client">
                    {(v: string | null) =>
                      v === null ? 'Choose a client' : v === NO_CLIENT ? 'No client' : (clientName(v) ?? 'Choose a client')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>No client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Category (optional)" htmlFor="si-category">
              <Input
                id="si-category"
                value={draft.category}
                placeholder="e.g. Content"
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </Field>

            <Field label="Priority" htmlFor="si-priority">
              <Select
                value={draft.priority}
                onValueChange={(v: string | null) =>
                  setDraft((d) => ({ ...d, priority: (v as TaskPriority) ?? 'medium' }))
                }
              >
                <SelectTrigger id="si-priority" className="w-full">
                  <SelectValue placeholder="Choose a priority">
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

            <Field label="Estimate" htmlFor="si-estimate">
              <HMInput
                id="si-estimate"
                label="Estimate"
                value={draft.estimatedHours}
                onChange={(h) => setDraft((d) => ({ ...d, estimatedHours: h }))}
              />
            </Field>

            <Field label="Expected output (optional)" htmlFor="si-output" className="sm:col-span-2">
              <Input
                id="si-output"
                value={draft.expectedOutput}
                placeholder="e.g. Draft blog post in Google Docs"
                onChange={(e) => setDraft((d) => ({ ...d, expectedOutput: e.target.value }))}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {full ? `The plan holds up to ${MAX_PLAN_ROWS} rows.` : 'Press Enter in Title to add.'}
            </p>
            <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={addRow}>
              Add
            </Button>
          </div>
        </section>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button" disabled={submitting}>
              Cancel
            </Button>
          }
        />
        <Button onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The line under a plan row: where it comes from, and its pills. */
function PlanRowMeta({ row }: { row: PlanDraft }) {
  if (row.kind === 'linked') {
    return (
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        <span>From {row.projectName}</span>
        <StatusPill status={row.status} />
        {row.isOverdue ? (
          <Badge variant="outline" className={OVERDUE_PILL_CLASSNAME}>
            Overdue
          </Badge>
        ) : null}
      </div>
    );
  }
  const details = [
    row.category || null,
    PRIORITY_LABELS[row.priority],
    row.estimatedHours !== null ? fmtHM(row.estimatedHours) : null,
  ].filter(Boolean);
  return (
    <p className="text-muted-foreground text-xs">
      {row.clientName ? `Ad-hoc, ${row.clientName}` : 'Ad-hoc'} · {details.join(' · ')}
    </p>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

