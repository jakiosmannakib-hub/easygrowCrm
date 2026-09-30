// app/api/export/client-tasks/route.ts (PUL-413, scoped by PUL-418): §13.8 `exportClientTasks`
//
// GET ?period=weekly|monthly&clientId=… | &accountId=… → the client-safe, white-label .xlsx
// (§3.1.7 / §6.3, Amendment M).
//
// The handler lives in `features/projects/client-export-response.ts`, where the refusal order
// (400 → 403 → 404) and the workbook are documented and tested. This file only wires it to the
// App Router.

import { clientExportResponse } from '@/features/projects/client-export-response';

export async function GET(request: Request): Promise<Response> {
  return clientExportResponse(request);
}
