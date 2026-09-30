// features/projects/client-export.ts — PUL-413, §3.1.7 / §6.3 / §13.8 `exportClientTasks`
//
// Turns `getClientExportRows` output into the client-forwardable workbook. Server-only (exceljs),
// and pure apart from that: no DB, no file I/O. The route handler owns the request and the
// response, and this module owns the sheet layout.
//
// Every cell's text goes through the SAME formatters the app UI uses (`monthLabel`, `fmtDate`,
// `fmtHM`), so a date or a duration reads identically on screen and in the file a client
// receives.
//
// PUL-418 (Amendment M): the file is scoped to one client or one account, and it is WHITE-LABEL.
// Clients are partners who resell our work to their own end businesses (the accounts), so the
// workbook must carry nothing that names the agency: not in a cell, a sheet name, the filename
// or the file's document properties. `client-export.test.ts` scans the raw .xlsx for it.

import ExcelJS from 'exceljs';
import { fmtDate, fmtHM } from '../../lib/format';
import { CLIENT_STATUS_LABEL, monthLabel, shiftIsoDay } from './display';
import type { ClientExportRange, ClientExportRow } from './queries';

/** The two export buttons (§14.3). */
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

/** The client-scope Summary sheet's columns (PUL-418.3): one row per account. */
export const CLIENT_EXPORT_SUMMARY_HEADERS = [
  'Account',
  'Completed',
  'In progress',
  'Total time',
] as const;

/** The Summary sheet's tab name. Reserved first, so an account called "Summary" gets " (2)". */
export const SUMMARY_SHEET_NAME = 'Summary';

/**
 * Every sheet opens with three header rows (report title, the name the sheet covers, the
 * period) and a blank spacer, so its column table starts on this row.
 */
export const CLIENT_EXPORT_TABLE_ROW = 5;

/** `Weekly report` / `Monthly report`: row 1 of every sheet. */
export function reportTitle(period: ClientExportPeriod): string {
  return period === 'weekly' ? 'Weekly report' : 'Monthly report';
}

/** `Sep 24, 2026 - Sep 30, 2026`: row 3 of every sheet. A spaced hyphen, never a dash glyph. */
export function reportPeriodLabel(range: ClientExportRange): string {
  return `${fmtDate(range.from, { relative: false })} - ${fmtDate(range.to, { relative: false })}`;
}

/**
 * `<slug>-<weekly|monthly>-report-<today>.xlsx` (PUL-418.3). The slug is the client or account
 * name, lowercased, accents folded, anything else collapsed to single hyphens. A name with no
 * letters or digits at all falls back to `report`, so the file never starts with a hyphen.
 */
export function clientExportFilename(
  scopeName: string,
  period: ClientExportPeriod,
  today: string,
): string {
  const slug =
    scopeName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
  return `${slug}-${period}-report-${today}.xlsx`;
}

/** Excel's hard limit on a worksheet name. */
const SHEET_NAME_MAX = 31;

/**
 * A client or account name → a legal, unique worksheet name.
 *
 * Excel refuses `: \ / ? * [ ]` in sheet names, a leading or trailing apostrophe, an empty name,
 * and anything over 31 characters. It also compares sheet names case-insensitively, so
 * "Acme" and "ACME" collide. A collision gets a ` (2)`, ` (3)`… suffix, with the base
 * truncated so the suffix still fits in 31 characters.
 */
export function sheetNameFor(name: string, taken: Set<string>): string {
  const cleaned =
    name
      .replace(/[:\\/?*[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim() || 'Account';

  let sheetName = cleaned.slice(0, SHEET_NAME_MAX).trim();
  for (let n = 2; taken.has(sheetName.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    sheetName = `${cleaned.slice(0, SHEET_NAME_MAX - suffix.length).trim()}${suffix}`;
  }
  taken.add(sheetName.toLowerCase());
  return sheetName;
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

/** What the workbook covers and when; the route builds it from the request and the clock. */
export interface ClientWorkbookInput {
  /** `getClientExportRows(range, scope)` for this same scope. */
  rows: readonly ClientExportRow[];
  /** The scope, with the name the route already looked up (row 2, the title, the filename). */
  scope: { kind: 'client' | 'account'; name: string };
  period: ClientExportPeriod;
  range: ClientExportRange;
  /** Stamped as the file's created / modified time. From the clock port, never `new Date()`. */
  now: Date;
}

/**
 * Add a sheet with the three report header rows and a blank spacer, then the bold column
 * header on `CLIENT_EXPORT_TABLE_ROW`, frozen so it stays in view while scrolling.
 */
function addReportSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  heading: { title: string; name: string; period: string },
  columns: { header: string; width: number }[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: CLIENT_EXPORT_TABLE_ROW }],
  });
  sheet.columns = columns.map((c) => ({ width: c.width }));

  sheet.addRow([heading.title]).font = { bold: true, size: 14 };
  sheet.addRow([heading.name]).font = { bold: true };
  sheet.addRow([heading.period]);
  sheet.addRow([]);
  sheet.addRow(columns.map((c) => c.header)).font = { bold: true };
  return sheet;
}

const TASK_COLUMN_WIDTHS = [28, 22, 44, 20, 16, 14, 12, 48];

/** One account's task table (§3.1.7 columns), after the sheet's header rows. */
function writeTaskRows(sheet: ExcelJS.Worksheet, rows: readonly ClientExportRow[]) {
  for (const row of rows) {
    const excelRow = sheet.addRow([
      row.projectName,
      row.month === null ? '' : monthLabel(row.projectStartDate, row.month),
      row.title,
      row.category,
      fmtDate(row.dueDate, { relative: false }),
      CLIENT_STATUS_LABEL[row.status],
      // No time logged → an EMPTY cell, not `fmtHM`'s on-screen `-` placeholder: in a sheet a
      // client may sum or filter, a blank is "nothing", and a hyphen is text in a number column.
      row.timeSpentHours === null ? '' : fmtHM(row.timeSpentHours),
      row.proofUrl ?? '',
    ]);

    if (row.proofUrl && isWebLink(row.proofUrl)) {
      const cell = excelRow.getCell(CLIENT_EXPORT_HEADERS.length);
      cell.value = { text: row.proofUrl, hyperlink: row.proofUrl };
      cell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  }
}

/**
 * The client-safe, white-label workbook (PUL-413.1, reshaped by PUL-418.3).
 *
 * - **Client scope:** a "Summary" sheet first, one row per account with work in the period
 *   (Completed = approved + completed, both of which the client sees as "Completed"; In progress;
 *   total time spent via `fmtHM`), then one sheet per account, named for the account.
 * - **Account scope:** one sheet, named for the account.
 *
 * Accounts are grouped by `accountId`, not by name: two accounts can share a name, and they must
 * not end up on one sheet. `sheetNameFor` gives the second one a distinct name. Only accounts
 * with at least one row appear (§3.1.7's "only clients with tasks in the period", one level
 * down).
 *
 * **Document properties** name the scope, never the agency: `title` is the client or account
 * name, and `creator`, `lastModifiedBy` and `company` are blank. exceljs writes nothing else
 * identifying unless it is set.
 */
export function buildClientWorkbook(input: ClientWorkbookInput): ExcelJS.Workbook {
  const { rows, scope, period, range, now } = input;

  const byAccount = new Map<string, ClientExportRow[]>();
  for (const row of rows) {
    const group = byAccount.get(row.accountId);
    if (group) group.push(row);
    else byAccount.set(row.accountId, [row]);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '';
  workbook.lastModifiedBy = '';
  workbook.company = '';
  workbook.title = scope.name;
  workbook.created = now;
  workbook.modified = now;

  const title = reportTitle(period);
  const periodLabel = reportPeriodLabel(range);
  const taken = new Set<string>();

  if (scope.kind === 'client' && byAccount.size > 0) {
    taken.add(SUMMARY_SHEET_NAME.toLowerCase());
    const summary = addReportSheet(
      workbook,
      SUMMARY_SHEET_NAME,
      { title, name: scope.name, period: periodLabel },
      CLIENT_EXPORT_SUMMARY_HEADERS.map((header, i) => ({
        header,
        width: i === 0 ? 32 : 14,
      })),
    );
    for (const accountRows of byAccount.values()) {
      const first = accountRows[0];
      if (!first) continue;
      const hours = accountRows.reduce((sum, r) => sum + (r.timeSpentHours ?? 0), 0);
      summary.addRow([
        first.accountName,
        accountRows.filter((r) => r.status === 'approved' || r.status === 'completed').length,
        accountRows.filter((r) => r.status === 'in_progress').length,
        fmtHM(hours),
      ]);
    }
  }

  for (const accountRows of byAccount.values()) {
    const first = accountRows[0];
    if (!first) continue;

    const sheet = addReportSheet(
      workbook,
      sheetNameFor(first.accountName, taken),
      { title, name: first.accountName, period: periodLabel },
      CLIENT_EXPORT_HEADERS.map((header, i) => ({ header, width: TASK_COLUMN_WIDTHS[i] ?? 16 })),
    );
    writeTaskRows(sheet, accountRows);
  }

  return workbook;
}
