// features/projects/components/project-header.tsx — PUL-408 Stage 2, §14.3
//
// The project header: breadcrumb `📁 Client › Project · type · Month N`, progress `X/Y · N%`
// with a bar, the §3.1.3 health chip, "+ New Task" (MGR) and the ⋯ overflow carrying Archive
// (MGR).
//
// Everything it draws is computed over the WHOLE project, never the filtered set (§14.3 says so
// for the health chip, and progress follows for the same reason): a header that moved with the
// Month ▾ filter would report On Track while the months you are not looking at are on fire.

'use client';

import { useEffect, useState } from 'react';
import { MoreHorizontalIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { showErrorToast } from '@/lib/show-error-toast';
import { archiveProject, loadProjectHeader } from '../actions';
import { HEALTH_DISPLAY } from '../display';
import { NewTaskModal } from './new-task-modal';

/**
 * The success payload only. Derived from the action's return type rather than restated, so the
 * `ActionResult` boundary (PUL-111) cannot drift from what this component reads — change the
 * action's shape and this stops compiling. Same pattern as the Task Detail modal.
 */
type HeaderPayload = NonNullable<
  Extract<Awaited<ReturnType<typeof loadProjectHeader>>, { ok: true }>['data']
>;

export function ProjectHeader({
  projectId,
  refreshKey,
  onChanged,
}: {
  projectId: string;
  /**
   * The filter bar's `taskNonce` — the ONE refetch counter for the page (PUL-409 Stage 2).
   *
   * Every mutation that can move this header's numbers bumps it: New Task and Archive here, and
   * closing the Task Detail modal on the Board. It sits in the load effect's dependencies, so a
   * status change made in the modal re-reads `getProjectHeader` in the same tick the board
   * re-reads its list, and the progress bar and health chip move in lockstep with the card.
   *
   * It replaced a private nonce this component used to hold. With both, a New Task here would
   * have bumped the private one AND the parent's, and fetched the header twice.
   */
  refreshKey: number;
  /**
   * Called after any mutation that can change the task list — a created task, an archived
   * project. The filter bar owns the nonce, so the header reports upward and the bump comes
   * back down as `refreshKey`.
   */
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<HeaderPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    // Guards a stale response from an earlier project landing on a newer one — switching
    // projects quickly can otherwise leave project A's progress under project B's name.
    let current = true;

    void (async () => {
      const result = await loadProjectHeader({ projectId });
      if (!current) return;

      if (!result.ok) {
        setFailed(true);
        showErrorToast(result);
        return;
      }
      // `null` means the project is gone or soft-deleted — treated as a load failure rather
      // than rendered as an empty header claiming 0/0.
      if (result.data === null) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setPayload(result.data);
    })();

    return () => {
      current = false;
    };
  }, [projectId, refreshKey]);

  /**
   * Refetch the header AND the filter bar's list — one bump of the parent's nonce does both,
   * because it comes back down as `refreshKey`.
   */
  function refetchAll() {
    onChanged();
  }

  async function onArchive() {
    setArchiving(true);
    try {
      const result = await archiveProject({ projectId });
      if (!result.ok) {
        // Including GATE:pending_reviews, whose message already names the blocking task —
        // `showErrorToast` surfaces it verbatim rather than restating it here (§14.3).
        showErrorToast(result);
        return;
      }
      // Not optimistic: archiving is an accountability action (§14.15 r.5).
      toast.success('Project archived.');
      refetchAll();
    } finally {
      setArchiving(false);
    }
  }

  if (failed) {
    return (
      <p className="text-muted-foreground text-xs">
        Couldn&apos;t load this project&apos;s header.
      </p>
    );
  }

  if (payload === null) {
    return <p className="text-muted-foreground text-xs">Loading project…</p>;
  }

  const { header, viewer } = payload;
  const health = HEALTH_DISPLAY[header.health];
  const { done, total, pct } = header.progress;

  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* §14.3's crumb. The folder glyph is decorative — `aria-hidden` so a screen reader
            reads the path, not "folder". */}
        <p className="text-sm font-medium">
          <span aria-hidden="true">📁 </span>
          <span className="text-muted-foreground">{header.client.name}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            {' › '}
          </span>
          {header.name}
          <span className="text-muted-foreground font-normal">
            {' · '}
            {header.type}
            {' · '}
            Month {header.currentMonth}
          </span>
        </p>

        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${health.className}`}
        >
          {health.label}
        </span>

        {header.status === 'archived' ? (
          <span className="text-muted-foreground border-border rounded-full border px-2 py-0.5 text-[11px]">
            Archived
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {viewer.canCreateTask ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              + New Task
            </Button>
          ) : null}

          {/* §14.3 puts Archive in an overflow. The whole control is hidden when there is
              nothing in it — an empty ⋯ menu is a dead end, not a discoverable affordance. */}
          {viewer.canArchive ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="outline" size="sm" aria-label="More project actions">
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <MenuContent>
                <MenuItem variant="destructive" disabled={archiving} onClick={() => void onArchive()}>
                  {archiving ? 'Archiving…' : 'Archive project'}
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </div>
      </div>

      {/* §3.1 / §14.3 progress: `X/Y · N%` plus the bar. */}
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs">
          {done}/{total} · {pct}%
        </p>
        <div
          className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Project progress"
        >
          <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {viewer.canCreateTask ? (
        <NewTaskModal
          projectId={projectId}
          open={creating}
          onOpenChange={setCreating}
          onCreated={refetchAll}
        />
      ) : null}
    </div>
  );
}
