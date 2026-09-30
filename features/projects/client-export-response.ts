// features/projects/client-export-response.ts (PUL-413, scoped by PUL-418.1; §13.8)
//
// The whole of `GET /api/export/client-tasks`. `app/api/export/client-tasks/route.ts` only
// delegates here, so the handler lives in the slice with relative imports, where vitest can
// reach it (the test rig has no `@/` alias).
//
// GET ?period=weekly|monthly&clientId=… | &accountId=… → the client-safe, white-label .xlsx.
//
// A route handler rather than a server action, because the response is a binary file. It
// therefore returns plain HTTP status codes, not an `ActionResult`. No stack trace or error
// body ever leaves: 400 / 403 / 404 carry a one-line plain-text reason, and anything unexpected
// is re-thrown for Next to turn into a redacted 500.
//
// Order of refusals: the request's SHAPE first (400, which reveals nothing), then the viewer
// (403), and only then whether the id exists (404). Checking existence before the role would
// let a non-manager probe which client and account ids are real.
//
// It writes nothing, so there is no transaction and no audit row. An export is a read (§13.8
// lists it with the queries).

import { AppError } from '../../lib/errors';
import { clock } from '../../lib/clock';
import { dhakaToday } from '../../lib/format';
import { getSessionUser } from '../../lib/session';
import {
  buildClientWorkbook,
  clientExportFilename,
  clientExportRange,
  isClientExportPeriod,
} from './client-export';
import { isManagerRole } from './display';
import { getClientExportRows, getClientExportScopeName, type ClientExportScope } from './queries';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * `?clientId=` or `?accountId=`, exactly one (§13.8, Amendment M). An empty value counts as
 * absent. `null` means the request named neither or both, which is a 400.
 */
function parseScope(params: URLSearchParams): ClientExportScope | null {
  const clientId = params.get('clientId') || null;
  const accountId = params.get('accountId') || null;
  if ((clientId === null) === (accountId === null)) return null;
  return clientId !== null
    ? { kind: 'client', clientId }
    : { kind: 'account', accountId: accountId as string };
}

export async function clientExportResponse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const period = params.get('period');
  if (!isClientExportPeriod(period)) return plain(400, 'period must be weekly or monthly');

  const scope = parseScope(params);
  if (scope === null) return plain(400, 'Give exactly one of clientId or accountId');

  /*
   * The SAME gate as the export buttons: `canExport={isManagerRole(viewer.role)}` on the
   * projects page (§14.3, "MGR-only"). §9.6 has no export row to `authorize()` against, which is
   * the same gap PUL-412 flagged for workload, so this checks the role directly. The role and
   * `active` come from `getSessionUser()`, which re-reads them from the DB (§16.5). A stale
   * session cannot export.
   */
  try {
    const viewer = await getSessionUser();
    if (!isManagerRole(viewer.role)) return plain(403, 'Forbidden');
  } catch (err) {
    if (err instanceof AppError) return plain(403, 'Forbidden');
    throw err;
  }

  // Unknown and archived (soft-deleted) read the same from outside: nothing to report on.
  const scopeName = await getClientExportScopeName(scope);
  if (scopeName === null) return plain(404, 'Not found');

  const today = dhakaToday();
  const range = clientExportRange(period, today);
  const rows = await getClientExportRows(range, scope);

  // Zero rows → a JSON marker the button turns into a toast, rather than a workbook with no
  // sheets (which Excel refuses to open).
  if (rows.length === 0) return Response.json({ empty: true });

  const workbook = buildClientWorkbook({
    rows,
    scope: { kind: scope.kind, name: scopeName },
    period,
    range,
    now: clock.now(),
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = clientExportFilename(scopeName, period, today);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
