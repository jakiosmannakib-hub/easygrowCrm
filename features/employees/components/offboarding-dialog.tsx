// features/employees/components/offboarding-dialog.tsx — PUL-206.3 (Stage 3), §14.12 / §13.1.4
//
// The offboarding checklist. §14.12: "lists every open assignment (reassign ▾ / cancel) and
// every routed review (reroute ▾); the Deactivate button stays disabled until every row is
// resolved; blocked entirely with an explanation if it would leave <2 managers."
//
// **Both lists are necessarily empty until PUL-401** — `project_tasks` is migration 008, so no
// assignment or routed review can exist to resolve. That is a fact about the schema, not a
// stub: `getDeactivationBlockers` returns real (empty) arrays, and the row rendering below is
// written against the final shape, so PUL-401 fills in data without touching this file.

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showErrorToast } from '@/lib/show-error-toast';
import { deactivateEmployee, loadOffboardingContext } from '../actions';
import type { EmployeeCard, PickableUser } from '../queries';

/** §13.1.4's marker for "close this task instead of moving it". Not a user id. */
const CANCEL = 'cancel';

type OffboardingContext = Awaited<ReturnType<typeof loadOffboardingContext>>;

export function OffboardingDialog({
  employee,
  pickableUsers,
  open,
  onOpenChange,
}: {
  employee: EmployeeCard;
  /** From `activeUsersQuery` — a deactivated person is never offered new work. */
  pickableUsers: PickableUser[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const [context, setContext] = useState<OffboardingContext | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // taskId → new assignee id, or CANCEL. taskId → new reviewer id.
  const [reassignments, setReassignments] = useState<Record<string, string>>({});
  const [rerouted, setRerouted] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setContext(null);
    setLoadFailed(false);
    setReassignments({});
    setRerouted({});
    try {
      setContext(await loadOffboardingContext({ userId: employee.id }));
    } catch (error) {
      // Without the blockers we cannot say whether it is safe to deactivate, so the button
      // stays disabled and the dialog says so rather than offering a guess.
      setLoadFailed(true);
      showErrorToast(error as { code: string; message?: string });
    }
  }

  const blockers = context?.blockers;
  const openAssignments = blockers?.openAssignments ?? [];
  const routedReviews = blockers?.routedReviews ?? [];

  // §14.12 — every row must be resolved. Vacuously true while both lists are empty, which is
  // the whole of Phase 2.
  const allResolved =
    openAssignments.every((t) => reassignments[t.taskId]) &&
    routedReviews.every((t) => rerouted[t.taskId]);

  /**
   * The "blocked entirely" case, §14.12. Advisory ONLY: the count came from a read that
   * another admin can invalidate a moment later. The `user_min_managers` trigger inside the
   * UPDATE is the enforcement, and its `GATE:last_managers` still reaches the user as a toast
   * if this check is somehow passed.
   */
  const wouldStrandManagers =
    context !== null && context.targetIsManager && context.managerCount <= 2;

  const canDeactivate =
    context !== null && !loadFailed && allResolved && !wouldStrandManagers && !submitting;

  async function onConfirm() {
    setSubmitting(true);
    try {
      await deactivateEmployee({
        userId: employee.id,
        // Both are empty until PUL-401; the pickers below already write into the state these
        // read from, so that ticket changes the query, not this call.
        reassignments: openAssignments.map((t) => ({
          taskId: t.taskId,
          newAssigneeId: reassignments[t.taskId]!,
        })),
        rerouted: routedReviews.map((t) => ({
          taskId: t.taskId,
          newReviewerId: rerouted[t.taskId]!,
        })),
      });
      // Not optimistic — deactivation is an accountability action (§14.15 r.5).
      toast.success(`${employee.name} has been deactivated.`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      showErrorToast(error as { code: string; message?: string });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        onOpenChange(next);
        // Fetched on open, not on mount: the checklist has to reflect the moment the admin
        // decides, and re-opening after resolving something elsewhere must re-read.
        if (next) void load();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deactivate {employee.name}?</DialogTitle>
          <DialogDescription>
            Their sessions end immediately and they can no longer sign in. The account and its
            history are kept — this is offboarding, not deletion.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[50vh] gap-4 overflow-y-auto">
          {context === null && !loadFailed ? (
            <p className="text-muted-foreground text-xs">Checking open work…</p>
          ) : null}

          {loadFailed ? (
            <p className="text-destructive text-xs">
              Couldn&apos;t check their open work. Close this and try again.
            </p>
          ) : null}

          {context !== null ? (
            <>
              <BlockerSection
                title="Open assignments"
                emptyLabel="No open tasks assigned to them."
                rows={openAssignments}
                value={reassignments}
                onChange={(taskId, value) => setReassignments((r) => ({ ...r, [taskId]: value }))}
                users={pickableUsers}
                excludeUserId={employee.id}
                placeholder="Reassign to…"
                // §13.1.4 allows closing a task instead of moving it; a review has to go
                // to a person, so only this section offers the choice.
                allowCancel
              />

              <BlockerSection
                title="Reviews routed to them"
                emptyLabel="No reviews are waiting on them."
                rows={routedReviews}
                value={rerouted}
                onChange={(taskId, value) => setRerouted((r) => ({ ...r, [taskId]: value }))}
                users={pickableUsers}
                excludeUserId={employee.id}
                placeholder="Reroute to…"
              />

              {wouldStrandManagers ? (
                <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-xs">
                  {employee.name} is one of only {context.managerCount} active managers.
                  Deactivating them would leave fewer than two, which isn&apos;t allowed. Promote
                  someone else first.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
          <Button variant="destructive" onClick={onConfirm} disabled={!canDeactivate}>
            {submitting ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One checklist section. Written against the final row shape (`{ taskId, title }`) so PUL-401
 * only has to make `getDeactivationBlockers` return rows — no rendering changes here.
 */
function BlockerSection({
  title,
  emptyLabel,
  rows,
  value,
  onChange,
  users,
  excludeUserId,
  placeholder,
  allowCancel = false,
}: {
  title: string;
  emptyLabel: string;
  rows: Array<{ taskId: string; title: string }>;
  value: Record<string, string>;
  onChange: (taskId: string, value: string) => void;
  users: PickableUser[];
  excludeUserId: string;
  placeholder: string;
  allowCancel?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium">
        {title}
        {rows.length > 0 ? (
          <span className="text-muted-foreground font-normal"> · {rows.length}</span>
        ) : null}
      </h4>

      {rows.length === 0 ? (
        // §14.15 r.4 — an empty state that explains itself rather than a blank area.
        <p className="text-muted-foreground text-xs">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.taskId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{row.title}</span>
              <Select
                value={value[row.taskId] ?? ''}
                onValueChange={(next: string | null) => onChange(row.taskId, next ?? '')}
              >
                <SelectTrigger aria-label={placeholder} className="w-44">
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {allowCancel ? <SelectItem value={CANCEL}>Cancel the task</SelectItem> : null}
                  {users
                    // The person being offboarded can't inherit their own work.
                    .filter((u) => u.id !== excludeUserId)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
