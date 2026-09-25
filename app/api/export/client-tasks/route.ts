// app/api/export/client-tasks/route.ts — PUL-413, §13.8 `exportClientTasks`
//
// GET ?period=weekly|monthly → the client-safe .xlsx (§3.1.7 / §6.3).
//
// A route handler rather than a server action, because the response is a binary file. It
// therefore returns plain HTTP status codes, not an `ActionResult`. No stack trace or error
// body ever leaves this handler: 400 / 403 carry a one-line plain-text reason, and anything
// unexpected is re-thrown for Next to turn into a redacted 500.
//
// It writes nothing, so there is no transaction and no audit row. An export is a read (§13.8
// lists it with the queries).

import {
  buildClientWorkbook,
  clientExportRange,
  isClientExportPeriod,
} from '@/features/projects/client-export';
import { isManagerRole } from '@/features/projects/display';
import { getClientExportRows } from '@/features/projects/queries';
import { AppError } from '@/lib/errors';
import { dhakaToday } from '@/lib/format';
import { getSessionUser } from '@/lib/session';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function plain(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(request: Request): Promise<Response> {
  const period = new URL(request.url).searchParams.get('period');
  if (!isClientExportPeriod(period)) return plain(400, 'period must be weekly or monthly');

  /*
   * The SAME gate as the filter-bar buttons: `canExport={isManagerRole(viewer.role)}` on the
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

  const today = dhakaToday();
  const rows = await getClientExportRows(clientExportRange(period, today));

  // Zero rows → a JSON marker the button turns into a toast, rather than a workbook with no
  // sheets (which Excel refuses to open).
  if (rows.length === 0) return Response.json({ empty: true });

  const buffer = await buildClientWorkbook(rows).xlsx.writeBuffer();
  const filename = `client-tasks-${period}-${today}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
