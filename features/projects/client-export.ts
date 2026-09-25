// features/projects/client-export.ts — PUL-413, §3.1.7 / §6.3 / §13.8 `exportClientTasks`
//
// Turns `getClientExportRows` output into the client-forwardable workbook. Server-only (exceljs),
// and pure apart from that: no DB, no file I/O. The route handler owns the request and the
// response, and this module owns the sheet layout.
//
// Every cell's text goes through the SAME formatters the app UI uses (`monthLabel`, `fmtDate`,
// `fmtHM`), so a date or a duration reads identically on screen and in the file a client
// receives.

import ExcelJS from 'exceljs';
import { fmtDate, fmtHM } from '../../lib/format';
import { CLIENT_STATUS_LABEL, monthLabel, shiftIsoDay } from './display';
import type { ClientExportRange, ClientExportRow } from './queries';

/** The two filter-bar buttons (§14.3). */
export const CLIENT_EXPORT_PERIODS = ['weekly', 'monthly'] as const;
export type ClientExportPeriod = (typeof CLIENT_EXPORT_PERIODS)[number];

export function isClientExportPeriod(value: string | null): value is ClientExportPeriod {
  return (CLIENT_EXPORT_PERIODS as readonly (string | null)[]).includes(value);
}

/**
 * §3.1.7: Weekly = the last 7 days by due date, Monthly = the last 30, both ending today
 * (inclusive). `today` is `dhakaToday()` from the caller, so a frozen test clock moves the
 * window too.
 */
export function clientExportRange(period: ClientExportPeriod, today: string): ClientExportRange {
  const days = period === 'weekly' ? 7 : 30;
  return { from: shiftIsoDay(today, -(days - 1)), to: today };
}

/** §3.1.7 / §6.3's column order. Headers are client-facing copy. */
export const CLIENT_EXPORT_HEADERS = [
  'Project',
  'Month',
  'Task',
  'Category',
  'Due date',
  'Status',
  'Time spent',
  'Deliverable',
] as const;

/** Excel's hard limit on a worksheet name. */
const SHEET_NAME_MAX = 31;

/**
 * A client name → a legal, unique worksheet name.
 *
 * Excel refuses `: \ / ? * [ ]` in sheet names, a leading or trailing apostrophe, an empty name,
 * and anything over 31 characters. It also compares sheet names case-insensitively, so
 * "Acme" and "ACME" collide. A collision gets a ` (2)`, ` (3)`… suffix, with the base
 * truncated so the suffix still fits in 31 characters.
 */
export function sheetNameFor(clientName: string, taken: Set<string>): string {
  const cleaned =
    clientName
      .replace(/[:\\/?*[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim() || 'Client';

  let name = cleaned.slice(0, SHEET_NAME_MAX).trim();
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${cleaned.slice(0, SHEET_NAME_MAX - suffix.length).trim()}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Only `http(s)` proofs become clickable hyperlinks. `proof_value` is text an employee typed,
 * and a `javascript:` or `file:` link in a workbook sent to a client is not something to hand
 * them. Anything else is written as plain text. This is the same rule the Review tab uses for
 * `href` (PUL-412).
 */
function isWebLink(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * The client-safe workbook (PUL-413.1): one worksheet per client, named for the client, in the
 * order the rows arrive (`getClientExportRows` sorts by client name). Only clients with at least
 * one row get a sheet (§3.1.7).
 *
 * Grouped by `clientId`, not by name: two clients can share a name, and they must not end up
 * on one sheet. `sheetNameFor` gives the second one a distinct name.
 */
export function buildClientWorkbook(rows: readonly ClientExportRow[]): ExcelJS.Workbook {
  const byClient = new Map<string, ClientExportRow[]>();
  for (const row of rows) {
    const group = byClient.get(row.clientId);
    if (group) group.push(row);
    else byClient.set(row.clientId, [row]);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EasyGrow Digital';

  const taken = new Set<string>();
  for (const clientRows of byClient.values()) {
    const first = clientRows[0];
    if (!first) continue;

    const sheet = workbook.addWorksheet(sheetNameFor(first.clientName, taken), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { width: 28 },
      { width: 22 },
      { width: 44 },
      { width: 20 },
      { width: 16 },
      { width: 14 },
      { width: 12 },
      { width: 48 },
    ];

    const header = sheet.addRow([...CLIENT_EXPORT_HEADERS]);
    header.font = { bold: true };

    for (const row of clientRows) {
      const excelRow = sheet.addRow([
        row.projectName,
        row.month === null ? '' : monthLabel(row.projectStartDate, row.month),
        row.title,
        row.category,
        fmtDate(row.dueDate, { relative: false }),
        CLIENT_STATUS_LABEL[row.status],
        fmtHM(row.timeSpentHours),
        row.proofUrl ?? '',
      ]);

      if (row.proofUrl && isWebLink(row.proofUrl)) {
        const cell = excelRow.getCell(CLIENT_EXPORT_HEADERS.length);
        cell.value = { text: row.proofUrl, hyperlink: row.proofUrl };
        cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
  }

  return workbook;
}
