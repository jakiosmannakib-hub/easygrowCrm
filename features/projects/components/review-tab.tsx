// features/projects/components/review-tab.tsx — PUL-412 Stage 2, §14.3.5
//
// The project Review tab: the canonical review queue (`getReviewQueue`, §16.9) scoped to the
// selected project, or agency-wide with "All projects". MGR/HR only: the tab is hidden from
// employees, and `loadReviewQueue` refuses them regardless (`review.read`).
//
// **Unlike Board / List / Calendar, this tab fetches its own rows.** It reads a different query
// from `getFilteredTasks` (submitted tasks joined to their latest submission), so it cannot share
// the filter bar's `tasks` array. It re-reads when the project changes, when the "Routed to me"
// chip toggles, and after the Task Detail modal closes.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fmtHM } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { cn } from '@/lib/utils';
import { loadReviewQueue } from '../actions';
import { TaskDetailModal } from './task-detail-modal';

/** The row shape, derived from the action so the ActionResult boundary can't drift (PUL-111). */
type ReviewRow = Extract<Awaited<ReturnType<typeof loadReviewQueue>>, { ok: true }>['data'][number];

/** §14.3.5's columns: Task · Project · Submitted by · Routed to · Summary · Hours · Proof · Review. */
const ROW_GRID =
  'grid grid-cols-[minmax(10rem,1.4fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(10rem,2fr)_4rem_4rem_5.5rem] items-center gap-3';

/**
 * Only http(s) proof values become links. `proof_value` is employee-entered text, and rendering
 * an arbitrary string into `href` is how a `javascript:` URL gets clicked; anything else shows as
 * plain text.
 */
function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function ReviewTab({
  projectId,
  onCount,
  onChanged,
}: {
  /** The selected project, or `undefined` for the agency-wide queue. */
  projectId: string | undefined;
  /** Reports the loaded queue size up to the tab strip, which shows it in the tab title. */
  onCount: (count: number) => void;
  /** After the Task Detail modal closes: the parent re-reads its task list + header too. */
  onChanged: () => void;
}) {
  /** §14.3.5's "Routed to me" chip. */
  const [routedToMe, setRoutedToMe] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  /** `'loading'` only until the first read lands; later re-reads keep the rows on screen. */
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  /** Bumped after the modal closes to re-run the read. */
  const [nonce, setNonce] = useState(0);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Same stale-response guard as the filter bar: only the newest request may write.
  const latestRequest = useRef(0);

  useEffect(() => {
    const token = ++latestRequest.current;
    void (async () => {
      setRefreshing(true);
      const result = await loadReviewQueue({ projectId, routedToMe });
      if (token !== latestRequest.current) return;
      setRefreshing(false);

      if (!result.ok) {
        showErrorToast(result);
        setPhase('failed');
        return;
      }
      setRows(result.data);
      setPhase('loaded');
      onCount(result.data.length);
    })();
    // `onCount` is a parent setter-wrapper; re-running on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, routedToMe, nonce]);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">
            Awaiting review
            {phase === 'loaded' ? (
              <span className="text-muted-foreground ml-1.5 tabular-nums">({rows.length})</span>
            ) : null}
          </h2>
          {/* §14.3.5's filter chip: the latest submission's routing hint is the viewer. */}
          <button
            type="button"
            aria-pressed={routedToMe}
            onClick={() => setRoutedToMe((v) => !v)}
            className={cn(
              'ml-auto rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              routedToMe
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Routed to me
          </button>
        </div>

        {phase === 'loading' ? (
          <div aria-busy aria-label="Loading review queue" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-muted h-9 animate-pulse rounded-md" />
            ))}
          </div>
        ) : phase === 'failed' ? (
          <p className="text-destructive text-xs">Couldn&apos;t load the review queue.</p>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground border-border rounded-md border border-dashed p-10 text-center text-sm">
            No tasks awaiting review.
          </div>
        ) : (
          <div
            aria-busy={refreshing}
            className={cn('overflow-x-auto transition-opacity', refreshing && 'opacity-60')}
          >
            <div className="border-border min-w-[64rem] rounded-md border">
              <div
                className={cn(
                  ROW_GRID,
                  'bg-muted/40 text-muted-foreground border-border border-b px-3 py-2 text-[0.625rem] font-medium tracking-wide uppercase',
                )}
              >
                <span>Task</span>
                <span>Project</span>
                <span>Submitted by</span>
                <span>Routed to</span>
                <span>Summary</span>
                <span>Hours</span>
                <span>Proof</span>
                <span className="sr-only">Review</span>
              </div>
              <div className="divide-border divide-y">
                {rows.map((row) => (
                  <div key={row.taskId} className={cn(ROW_GRID, 'px-3 py-2 text-xs')}>
                    <span className="truncate font-medium" title={row.taskTitle}>
                      {row.taskTitle}
                    </span>
                    <span className="truncate">{row.project.name}</span>
                    <span className="truncate">{row.submittedBy.name}</span>
                    <span className={cn('truncate', !row.routedTo && 'text-muted-foreground')}>
                      {row.routedTo?.name ?? 'Anyone'}
                    </span>
                    {/* Truncated per §14.3.5; the full text is one hover away. */}
                    <span className="text-muted-foreground truncate" title={row.summary}>
                      {row.summary}
                    </span>
                    <span className="tabular-nums">{fmtHM(row.hours)}</span>
                    <span>
                      {row.proofValue && isWebUrl(row.proofValue) ? (
                        <a
                          href={row.proofValue}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline underline-offset-2"
                        >
                          Proof
                        </a>
                      ) : row.proofValue ? (
                        <span className="text-muted-foreground truncate" title={row.proofValue}>
                          {row.proofValue}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                    {/*
                      INTERIM (PUL-602): "Review" opens the Task Detail modal so a manager can read
                      the submission. The real Review Decision modal — Approve / Request Revision,
                      rating, note, CONFLICT "Already reviewed by …" — is PUL-602, and this button
                      is re-pointed at it then.
                    */}
                    <Button size="sm" variant="outline" onClick={() => setOpenTaskId(row.taskId)}>
                      Review
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <TaskDetailModal
        taskId={openTaskId ?? ''}
        open={openTaskId !== null}
        onClose={() => {
          setOpenTaskId(null);
          // Re-read the queue (a manager override may have moved the task out of `submitted`)
          // and tell the parent, whose Board / List / header read the same task.
          setNonce((n) => n + 1);
          onChanged();
        }}
      />
    </>
  );
}
