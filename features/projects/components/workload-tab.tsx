// features/projects/components/workload-tab.tsx — PUL-412 Stage 2, §14.3.6
//
// The Workload tab: per-person open-task capacity (count + estimated hours) with an on-break dot.
// MGR/HR only: the tab is hidden from employees, and `loadWorkload` refuses them regardless
// (a role gate in the action — §9.6 has no workload permission; see `loadWorkload`).
//
// Its own fetch, like the Review tab: `getWorkload` is an aggregate, not the filter bar's task
// list. Re-reads when the project changes. Rows arrive sorted most-loaded first.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { fmtHM } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { cn } from '@/lib/utils';
import { initials } from '@/features/employees/display';
import { loadWorkload } from '../actions';

type WorkloadRow = Extract<Awaited<ReturnType<typeof loadWorkload>>, { ok: true }>['data'][number];

const ROW_GRID = 'grid grid-cols-[minmax(12rem,2fr)_6rem_6rem_5rem] items-center gap-3';

export function WorkloadTab({ projectId }: { projectId: string | undefined }) {
  const [rows, setRows] = useState<WorkloadRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    const token = ++latestRequest.current;
    void (async () => {
      setRefreshing(true);
      const result = await loadWorkload({ projectId });
      if (token !== latestRequest.current) return;
      setRefreshing(false);

      if (!result.ok) {
        showErrorToast(result);
        setPhase('failed');
        return;
      }
      setRows(result.data);
      setPhase('loaded');
    })();
  }, [projectId]);

  if (phase === 'loading') {
    return (
      <div aria-busy aria-label="Loading workload" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted h-10 animate-pulse rounded-md" />
        ))}
      </div>
    );
  }

  if (phase === 'failed') {
    return <p className="text-destructive text-xs">Couldn&apos;t load workload.</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-md border border-dashed p-10 text-center text-sm">
        No open tasks assigned.
      </div>
    );
  }

  return (
    <div
      aria-busy={refreshing}
      className={cn('overflow-x-auto transition-opacity', refreshing && 'opacity-60')}
    >
      <div className="border-border min-w-[30rem] rounded-md border">
        <div
          className={cn(
            ROW_GRID,
            'bg-muted/40 text-muted-foreground border-border border-b px-3 py-2 text-[0.625rem] font-medium tracking-wide uppercase',
          )}
        >
          <span>Person</span>
          <span>Open tasks</span>
          <span>Est hours</span>
          <span>On break</span>
        </div>
        <div className="divide-border divide-y">
          {rows.map((row) => (
            <div key={row.user.id} className={cn(ROW_GRID, 'px-3 py-2 text-xs')}>
              <span className="flex min-w-0 items-center gap-2">
                <Avatar size="sm">
                  {row.user.image ? <AvatarImage src={row.user.image} alt="" /> : null}
                  <AvatarFallback>{initials(row.user.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{row.user.name}</span>
              </span>
              <span className="tabular-nums">{row.openCount}</span>
              <span className="tabular-nums">{fmtHM(row.estHours)}</span>
              {/*
                §14.3.6's live on-break dot. ALWAYS grey today: `onBreak` is stubbed `false` in
                `getWorkload` because attendance (Phase 3, PUL-301…308) was skipped and there is
                no breaks table to read. TODO(Phase 3 / attendance): the green state below lights
                up with no change here once PUL-303 wires the field.
              */}
              <span className="flex items-center">
                <span
                  aria-label={row.onBreak ? 'On a break' : 'Not on a break'}
                  title={row.onBreak ? 'On a break' : 'Break status arrives with attendance'}
                  className={cn(
                    'size-2 rounded-full',
                    row.onBreak ? 'bg-green-500' : 'bg-muted-foreground/30',
                  )}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
