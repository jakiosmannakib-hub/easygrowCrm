// features/projects/components/workspace-overviews.tsx (PUL-417.3, §14.3 Amendment M)
//
// The right pane when the selection is not a project:
//   - a CLIENT: one card per account (projects, progress, open, awaiting review, overdue);
//   - an ACCOUNT: its projects, each with progress and the §3.1.3 health chip;
//   - NOTHING: the agency-wide Review and Workload tabs.
//
// The overviews draw straight from the workspace tree the page already read, so opening one
// costs no request; `router.refresh()` after a mutation refreshes them along with the tree.
// Clicking a card or a row selects that node, exactly like clicking it in the tree. Until
// PUL-418 scopes the Excel exports to a client or an account, the agency-wide PUL-413 buttons
// sit on the nothing-selected pane.

'use client';

import { useState } from 'react';
import { HEALTH_DISPLAY, type AgencyTabKey } from '../display';
import {
  projectNodeHealth,
  summarizeProjects,
  type WorkspaceAccountNode,
  type WorkspaceClientNode,
  type WorkspaceSelection,
} from '../workspace-tree';
import { ClientExportButtons } from './client-export-buttons';
import { ReviewTab } from './review-tab';
import { WorkloadTab } from './workload-tab';

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** `open 4 · awaiting review 2 · overdue 1`, with overdue in red when non-zero. */
function CountsLine({
  open,
  awaitingReview,
  overdue,
}: {
  open: number;
  awaitingReview: number;
  overdue?: number;
}) {
  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      {open} open · {awaitingReview} awaiting review
      {overdue === undefined ? null : (
        <>
          {' · '}
          <span className={overdue > 0 ? 'text-destructive font-medium' : undefined}>
            {overdue} overdue
          </span>
        </>
      )}
    </p>
  );
}

// ── Client ──────────────────────────────────────────────────────────────────────────────

export function ClientOverview({
  client,
  onSelect,
}: {
  client: WorkspaceClientNode;
  onSelect: (selection: WorkspaceSelection) => void;
}) {
  return (
    <section className="space-y-4" aria-label={`${client.name} overview`}>
      <h2 className="text-sm font-medium">
        <span aria-hidden="true">📁 </span>
        {client.name}
        <span className="text-muted-foreground font-normal">
          {' · '}
          {client.accounts.length} {client.accounts.length === 1 ? 'account' : 'accounts'}
        </span>
      </h2>

      {client.accounts.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No accounts yet. Add the businesses this client resells to from its ⋯ menu in the tree.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {client.accounts.map((account) => {
            const s = summarizeProjects(account.projects);
            return (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ client: client.id, account: account.id, project: null })
                  }
                  className="border-border hover:bg-muted/40 grid h-full w-full gap-2 rounded-lg border p-3 text-left"
                >
                  <span className="text-sm font-medium">
                    <span aria-hidden="true">🏢 </span>
                    {account.name}
                  </span>
                  {account.location ? (
                    <span className="text-muted-foreground text-xs">{account.location}</span>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    {s.projectCount} {s.projectCount === 1 ? 'project' : 'projects'} · {s.done}/
                    {s.total} · {s.pct}%
                  </span>
                  <ProgressBar pct={s.pct} label={`${account.name} progress`} />
                  <CountsLine open={s.open} awaitingReview={s.awaitingReview} overdue={s.overdue} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Account ─────────────────────────────────────────────────────────────────────────────

export function AccountOverview({
  client,
  account,
  onSelect,
}: {
  client: WorkspaceClientNode;
  account: WorkspaceAccountNode;
  onSelect: (selection: WorkspaceSelection) => void;
}) {
  return (
    <section className="space-y-4" aria-label={`${account.name} overview`}>
      <h2 className="text-sm font-medium">
        <span aria-hidden="true">📁 </span>
        <span className="text-muted-foreground">{client.name}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          {' › '}
        </span>
        <span aria-hidden="true">🏢 </span>
        {account.name}
        {account.location ? (
          <span className="text-muted-foreground font-normal"> · {account.location}</span>
        ) : null}
      </h2>

      {account.projects.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No active projects. Start one from this account&apos;s ⋯ menu in the tree.
        </p>
      ) : (
        <ul className="grid gap-2">
          {account.projects.map((project) => {
            const s = summarizeProjects([project]);
            const health = HEALTH_DISPLAY[projectNodeHealth(project)];
            return (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ client: client.id, account: account.id, project: project.id })
                  }
                  className="border-border hover:bg-muted/40 grid w-full gap-2 rounded-lg border p-3 text-left"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      <span aria-hidden="true">📋 </span>
                      {project.name}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${health.className}`}
                    >
                      {health.label}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      {s.done}/{s.total} · {s.pct}%
                    </span>
                  </span>
                  <ProgressBar pct={s.pct} label={`${project.name} progress`} />
                  <CountsLine open={s.open} awaitingReview={s.awaitingReview} overdue={s.overdue} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Nothing selected ────────────────────────────────────────────────────────────────────

const AGENCY_TAB_LABEL: Record<AgencyTabKey, string> = {
  review: 'Review',
  workload: 'Workload',
};

/**
 * The agency-wide Review and Workload tabs (`projectId` undefined = every active project). Both
 * are MGR/HR tabs (§14.3), so `tab` is null for anyone else and the pane says how to begin.
 */
export function AgencyPane({
  tab,
  canExport,
  onTab,
  onTreeStale,
}: {
  tab: AgencyTabKey | null;
  /** MGR only (§14.3, PUL-413): the page's `isManagerRole`. The route re-checks the role. */
  canExport: boolean;
  onTab: (tab: AgencyTabKey) => void;
  onTreeStale: () => void;
}) {
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  if (tab === null) {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a project from the tree to see its tasks.
      </p>
    );
  }

  // Both tabs share one visibility list (MGR/HR), so a non-null `tab` means both show.
  const tabs: AgencyTabKey[] = ['review', 'workload'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-xs">
          Every active project. Pick a client, account or project in the tree to narrow it.
        </p>
        {/*
          TODO(PUL-418): the agency-wide PUL-413 exports, parked here after the filter bar that
          held them went away. PUL-418 scopes them to a client or an account and moves them to
          the overviews.
        */}
        {canExport ? (
          <div className="ml-auto">
            <ClientExportButtons />
          </div>
        ) : null}
      </div>
      <div className="border-border flex gap-1 overflow-x-auto border-b">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onTab(key)}
            className={
              tab === key
                ? 'border-primary text-foreground -mb-px shrink-0 border-b-2 px-3 py-2 text-xs font-medium'
                : 'text-muted-foreground hover:text-foreground -mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-xs'
            }
          >
            {AGENCY_TAB_LABEL[key]}
            {key === 'review' && reviewCount !== null ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({reviewCount})</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === 'review' ? (
        <ReviewTab projectId={undefined} onCount={setReviewCount} onChanged={onTreeStale} />
      ) : (
        <WorkloadTab projectId={undefined} />
      )}
    </div>
  );
}
