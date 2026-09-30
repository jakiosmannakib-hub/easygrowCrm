// features/projects/components/client-export-buttons.tsx (PUL-413.2, scoped by PUL-418.4; §14.3)
//
// The MGR-only Weekly (Excel) / Monthly (Excel) buttons, in the client and account overview
// headers. Each one GETs `/api/export/client-tasks?period=…&clientId=…` (or `&accountId=…`)
// and either downloads the returned .xlsx or, on `{ empty: true }`, shows a toast.
//
// Visibility stays with the parent's `canExport` gate. Hiding the buttons is only cosmetic: the
// route re-checks the role from the DB and refuses everyone else with a 403.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Period = 'weekly' | 'monthly';

/** Exactly one client or one account (§13.8, Amendment M): the route 400s anything else. */
export type ClientExportButtonScope = { clientId: string } | { accountId: string };

const BUTTONS: { period: Period; label: string }[] = [
  { period: 'weekly', label: 'Weekly (Excel)' },
  { period: 'monthly', label: 'Monthly (Excel)' },
];

/** `attachment; filename="acme-weekly-report-2026-09-25.xlsx"` → the filename. */
function filenameFrom(disposition: string | null, period: Period): string {
  const match = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1] ?? `${period}-report.xlsx`;
}

function exportUrl(scope: ClientExportButtonScope, period: Period): string {
  const params = new URLSearchParams({ period });
  if ('clientId' in scope) params.set('clientId', scope.clientId);
  else params.set('accountId', scope.accountId);
  return `/api/export/client-tasks?${params.toString()}`;
}

export function ClientExportButtons({ scope }: { scope: ClientExportButtonScope }) {
  const [pending, setPending] = useState<Period | null>(null);

  async function download(period: Period) {
    setPending(period);
    try {
      const res = await fetch(exportUrl(scope, period));
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "You don't have access to exports."
            : res.status === 404
              ? 'This client or account no longer exists. Refresh the page.'
              : 'Export failed.',
        );
        return;
      }

      if (res.headers.get('Content-Type')?.includes('application/json')) {
        const body: unknown = await res.json();
        if (typeof body === 'object' && body !== null && 'empty' in body) {
          toast('No client-visible tasks in this period');
          return;
        }
      }

      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(res.headers.get('Content-Disposition'), period);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {BUTTONS.map(({ period, label }) => (
        <Button
          key={period}
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => void download(period)}
        >
          {pending === period ? 'Exporting…' : label}
        </Button>
      ))}
    </div>
  );
}
