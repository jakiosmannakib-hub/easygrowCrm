// features/projects/client-export.test.ts (PUL-413.3, extended by PUL-418.5 / 418.6)
//
// The client-safe Weekly / Monthly Excel export (§3.1.7 / §6.3 / §13.8). What it pins:
//
//   - `getClientExportRows(range, scope)` returns EXACTLY the expected rows for a fixed range and
//     ONE client or ONE account: the three client statuses only, `client_visible` only, both
//     range edges inclusive, soft-deleted work out, and no internal field (assignee, priority,
//     comments, submission summary) on any row. Rows carry the account (PUL-418.2).
//   - `buildClientWorkbook`: every sheet opens with the report title, the name it covers and the
//     period; a client file has a Summary sheet then one sheet per account; an account file has
//     one sheet. Cells go through the UI formatters, `approved` reads "Completed", and the
//     Deliverable column holds the proof link and nothing else.
//   - The route handler's refusals: 400 (shape), 403 (viewer), 404 (unknown or archived scope),
//     in that order, and the filename.
//   - PUL-418.6: the produced file names the agency NOWHERE: not in a cell, a sheet name, the
//     filename, the document properties, or any byte of the unzipped .xlsx.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The query does no session read
// (the MGR gate is the route's). For the route, the only stub is `auth.api.getSession`, as in
// features/clients/accounts.test.ts; `getSessionUser()` still reads role and active from
// Postgres.

import { inflateRawSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { accounts, clients, projects, projectTasks, taskSubmissions, user } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { dhakaToday } from '../../lib/format';
import { seedFull, type FullSeed } from '../../tests/seed';
import {
  buildClientWorkbook,
  CLIENT_EXPORT_HEADERS,
  CLIENT_EXPORT_SUMMARY_HEADERS,
  CLIENT_EXPORT_TABLE_ROW,
  clientExportFilename,
  clientExportRange,
  reportPeriodLabel,
  sheetNameFor,
  type ClientWorkbookInput,
} from './client-export';
import { getClientExportRows, type ClientExportRow, type ClientExportScope } from './queries';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { clientExportResponse } = await import('./client-export-response');

/** 2026-09-15 10:00 in Dhaka. The weekly window is therefore Sep 9 – Sep 15. */
const NOW = new Date('2026-09-15T04:00:00.000Z');
const RANGE = { from: '2026-09-09', to: '2026-09-15' };

let seed: FullSeed;

/**
 * Two clients. seedFull's own tasks have no due date, so none of them can match a range.
 *
 * INCLUDED (5):
 *   x_approved   Seed Retainer, M9, due 09-10, approved; actual NULL → latest submission 2.5h;
 *                https proof. Proves the relabel, the hours fallback and latest-wins.
 *   x_completed  Seed Retainer, M9, due 09-12, completed; actual 1.25h beats the 9h submission;
 *                no proof.
 *   x_from_edge  Seed Retainer, M9, due 09-09 (= from), in_progress, no hours at all.
 *   x_to_edge    Seed One-off, no month, due 09-15 (= to), in_progress.
 *   x_beta       Beta Site (Beta Client), M4, due 09-11, in_progress; non-URL proof text.
 *
 * EXCLUDED (in range and client-visible unless noted):
 *   submitted / blocked / cancelled / planned / revision_required, an approved task with
 *   client_visible=false, approved tasks due 09-08 and 09-16 (just outside), and a soft-deleted
 *   approved task.
 */
async function arrange() {
  await db.insert(clients).values({ id: 'client_beta', name: 'Beta Client' });
  await db
    .insert(accounts)
    .values({ id: 'acct_beta', clientId: 'client_beta', name: 'Beta Account' });
  await db.insert(projects).values({
    id: 'proj_beta',
    name: 'Beta Site',
    accountId: 'acct_beta',
    type: 'Retainer',
    startDate: '2026-06-01',
    deadline: null,
    createdBy: seed.projectManager.id,
  });

  const e1 = seed.employees[0];
  const base = {
    projectId: 'proj_seed',
    month: 9,
    category: 'Content',
    assigneeId: e1.id,
    priority: 'urgent' as const,
    clientVisible: true,
    createdBy: seed.projectManager.id,
    description: 'INTERNAL description',
    revisionNote: 'INTERNAL revision note',
  };

  await db.insert(projectTasks).values([
    {
      ...base,
      id: 'x_approved',
      title: 'Approved blog post',
      status: 'approved',
      dueDate: '2026-09-10',
    },
    {
      ...base,
      id: 'x_completed',
      title: 'Manager-closed audit',
      category: 'Audit',
      status: 'completed',
      dueDate: '2026-09-12',
      actualHours: '1.25',
    },
    {
      ...base,
      id: 'x_from_edge',
      title: 'From-edge task',
      status: 'in_progress',
      dueDate: '2026-09-09',
    },
    {
      ...base,
      id: 'x_to_edge',
      projectId: 'proj_seed_2',
      month: null,
      title: 'To-edge task',
      category: 'Reporting',
      status: 'in_progress',
      dueDate: '2026-09-15',
    },
    {
      ...base,
      id: 'x_beta',
      projectId: 'proj_beta',
      month: 4,
      title: 'Beta outreach',
      category: 'Link Building',
      status: 'in_progress',
      dueDate: '2026-09-11',
    },
    // ── excluded ──
    { ...base, id: 'x_submitted', title: 'Submitted', status: 'submitted', dueDate: '2026-09-11' },
    { ...base, id: 'x_blocked', title: 'Blocked', status: 'blocked', dueDate: '2026-09-11' },
    { ...base, id: 'x_cancelled', title: 'Cancelled', status: 'cancelled', dueDate: '2026-09-11' },
    { ...base, id: 'x_planned', title: 'Planned', status: 'planned', dueDate: '2026-09-11' },
    {
      ...base,
      id: 'x_revision',
      title: 'Needs revision',
      status: 'revision_required',
      dueDate: '2026-09-11',
    },
    {
      ...base,
      id: 'x_hidden',
      title: 'Internal-only approved',
      status: 'approved',
      dueDate: '2026-09-11',
      clientVisible: false,
    },
    {
      ...base,
      id: 'x_before',
      title: 'Day before range',
      status: 'approved',
      dueDate: '2026-09-08',
    },
    { ...base, id: 'x_after', title: 'Day after range', status: 'approved', dueDate: '2026-09-16' },
    {
      ...base,
      id: 'x_deleted',
      title: 'Soft-deleted',
      status: 'approved',
      dueDate: '2026-09-11',
      deletedAt: NOW,
    },
  ]);

  const sub = {
    submittedBy: e1.id,
    summary: 'INTERNAL submission summary',
    issues: 'INTERNAL issues',
    reviewerId: seed.teamLeader.id,
  };
  await db.insert(taskSubmissions).values([
    // x_approved went round the revision loop: the older submission must NOT be used.
    {
      ...sub,
      id: 'sub_x_approved_old',
      taskId: 'x_approved',
      hours: '9.00',
      proofType: 'url',
      proofValue: 'https://old.example.com/draft',
      createdAt: new Date('2026-09-09T04:00:00.000Z'),
    },
    {
      ...sub,
      id: 'sub_x_approved_new',
      taskId: 'x_approved',
      hours: '2.50',
      proofType: 'published_url',
      proofValue: 'https://client.example.com/blog/post',
      createdAt: new Date('2026-09-10T04:00:00.000Z'),
    },
    // actual_hours (1.25) wins over this 9h.
    {
      ...sub,
      id: 'sub_x_completed',
      taskId: 'x_completed',
      hours: '9.00',
      proofType: null,
      proofValue: null,
      createdAt: new Date('2026-09-12T04:00:00.000Z'),
    },
    {
      ...sub,
      id: 'sub_x_beta',
      taskId: 'x_beta',
      hours: '0.75',
      proofType: 'other',
      proofValue: 'Shared drive: /reports/sept',
      createdAt: new Date('2026-09-11T04:00:00.000Z'),
    },
  ]);
}

beforeEach(async () => {
  seed = await seedFull();
  setClock(createTestClock(NOW));
  await arrange();
});

afterEach(() => {
  resetClock();
  getSession.mockReset();
});

const SEED_CLIENT: ClientExportScope = { kind: 'client', clientId: 'seed_client' };
const BETA_CLIENT: ClientExportScope = { kind: 'client', clientId: 'client_beta' };
const SEED_ACCOUNT_TWO: ClientExportScope = { kind: 'account', accountId: 'seed_account_2' };

const seedAccount = {
  clientId: 'seed_client',
  clientName: 'Seed Client',
  accountId: 'seed_account',
  accountName: 'Seed Account',
};

const TO_EDGE: ClientExportRow = {
  clientId: 'seed_client',
  clientName: 'Seed Client',
  accountId: 'seed_account_2',
  accountName: 'Seed Account Two',
  projectName: 'Seed One-off',
  projectStartDate: '2026-03-01',
  month: null,
  title: 'To-edge task',
  category: 'Reporting',
  dueDate: '2026-09-15',
  status: 'in_progress',
  timeSpentHours: null,
  proofUrl: null,
};

/** Seed Client's rows: account → project → due date. "Seed Account" sorts before "... Two". */
const EXPECTED_SEED_CLIENT: ClientExportRow[] = [
  {
    ...seedAccount,
    projectName: 'Seed Retainer',
    projectStartDate: '2026-01-01',
    month: 9,
    title: 'From-edge task',
    category: 'Content',
    dueDate: '2026-09-09',
    status: 'in_progress',
    timeSpentHours: null,
    proofUrl: null,
  },
  {
    ...seedAccount,
    projectName: 'Seed Retainer',
    projectStartDate: '2026-01-01',
    month: 9,
    title: 'Approved blog post',
    category: 'Content',
    dueDate: '2026-09-10',
    status: 'approved',
    timeSpentHours: 2.5,
    proofUrl: 'https://client.example.com/blog/post',
  },
  {
    ...seedAccount,
    projectName: 'Seed Retainer',
    projectStartDate: '2026-01-01',
    month: 9,
    title: 'Manager-closed audit',
    category: 'Audit',
    dueDate: '2026-09-12',
    status: 'completed',
    timeSpentHours: 1.25,
    proofUrl: null,
  },
  TO_EDGE,
];

const EXPECTED_BETA_CLIENT: ClientExportRow[] = [
  {
    clientId: 'client_beta',
    clientName: 'Beta Client',
    accountId: 'acct_beta',
    accountName: 'Beta Account',
    projectName: 'Beta Site',
    projectStartDate: '2026-06-01',
    month: 4,
    title: 'Beta outreach',
    category: 'Link Building',
    dueDate: '2026-09-11',
    status: 'in_progress',
    timeSpentHours: 0.75,
    proofUrl: 'Shared drive: /reports/sept',
  },
];

/** Every key a row may carry. Anything else on a row is a leak. */
const CLIENT_SAFE_KEYS = [
  'accountId',
  'accountName',
  'category',
  'clientId',
  'clientName',
  'dueDate',
  'month',
  'projectName',
  'projectStartDate',
  'proofUrl',
  'status',
  'timeSpentHours',
  'title',
];

describe('clientExportRange', () => {
  it('weekly = 7 inclusive days, monthly = 30, both ending on the Dhaka today', () => {
    const today = dhakaToday();
    expect(today).toBe('2026-09-15');
    expect(clientExportRange('weekly', today)).toEqual(RANGE);
    expect(clientExportRange('monthly', today)).toEqual({ from: '2026-08-17', to: '2026-09-15' });
  });

  it('rolls over month and year boundaries without a Date', () => {
    expect(clientExportRange('weekly', '2026-03-03')).toEqual({
      from: '2026-02-25',
      to: '2026-03-03',
    });
    expect(clientExportRange('monthly', '2028-03-01')).toEqual({
      from: '2028-02-01',
      to: '2028-03-01',
    });
    expect(clientExportRange('weekly', '2027-01-02')).toEqual({
      from: '2026-12-27',
      to: '2027-01-02',
    });
  });
});

describe('getClientExportRows', () => {
  it('client scope: exactly that client’s client-safe rows, in account → project → due order', async () => {
    expect(await getClientExportRows(RANGE, SEED_CLIENT)).toEqual(EXPECTED_SEED_CLIENT);
    expect(await getClientExportRows(RANGE, BETA_CLIENT)).toEqual(EXPECTED_BETA_CLIENT);
  });

  it('account scope: only that account’s rows, never a sibling account’s', async () => {
    expect(await getClientExportRows(RANGE, SEED_ACCOUNT_TWO)).toEqual([TO_EDGE]);
    expect(
      await getClientExportRows(RANGE, { kind: 'account', accountId: 'seed_account' }),
    ).toEqual(EXPECTED_SEED_CLIENT.slice(0, 3));
  });

  it('drops an archived (soft-deleted) account’s work from its client’s export', async () => {
    await db.update(accounts).set({ deletedAt: NOW }).where(eq(accounts.id, 'seed_account_2'));
    expect(await getClientExportRows(RANGE, SEED_CLIENT)).toEqual(EXPECTED_SEED_CLIENT.slice(0, 3));
  });

  it('never carries an internal field: no assignee, priority, comments or submission notes', async () => {
    const rows = [
      ...(await getClientExportRows(RANGE, SEED_CLIENT)),
      ...(await getClientExportRows(RANGE, BETA_CLIENT)),
    ];
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(CLIENT_SAFE_KEYS);

    // The fixture put INTERNAL text in every internal column; none of it may surface anywhere.
    expect(JSON.stringify(rows)).not.toMatch(/INTERNAL|urgent|seed_e1|seed_tl/);
  });

  it('excludes submitted / blocked / cancelled / planned / revision, hidden, out-of-range and deleted', async () => {
    const titles = (await getClientExportRows(RANGE, SEED_CLIENT)).map((r) => r.title);
    for (const excluded of [
      'Submitted',
      'Blocked',
      'Cancelled',
      'Planned',
      'Needs revision',
      'Internal-only approved',
      'Day before range',
      'Day after range',
      'Soft-deleted',
    ]) {
      expect(titles).not.toContain(excluded);
    }
  });

  it('rejects a malformed or inverted range with VALIDATION', async () => {
    for (const bad of [
      { from: '2026-9-9', to: '2026-09-15' },
      { from: '2026-09-15', to: '2026-09-09' },
    ]) {
      await expect(getClientExportRows(bad, SEED_CLIENT)).rejects.toSatisfy(
        (e: unknown) => e instanceof AppError && e.code === 'VALIDATION',
      );
    }
  });
});

// ── Workbook helpers ─────────────────────────────────────────────────────────────────────

/** Serialize and reload, so assertions are about the real .xlsx and not the in-memory model. */
async function load(buffer: ArrayBuffer | Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb;
}

async function roundTrip(input: ClientWorkbookInput) {
  return load(await buildClientWorkbook(input).xlsx.writeBuffer());
}

async function workbookFor(scope: ClientExportScope, name: string) {
  return roundTrip({
    rows: await getClientExportRows(RANGE, scope),
    scope: { kind: scope.kind, name },
    period: 'weekly',
    range: RANGE,
    now: NOW,
  });
}

/** The three header rows' text (title, name, period) and whether the spacer row is blank. */
function headerRows(sheet: ExcelJS.Worksheet) {
  return {
    lines: [1, 2, 3].map((r) => sheet.getRow(r).getCell(1).text),
    spacerBlank: sheet.getRow(4).getCell(1).text === '',
  };
}

/** A sheet's column table as plain text, its header row first. */
function tableRows(sheet: ExcelJS.Worksheet, width: number): string[][] {
  const out: string[][] = [];
  for (let r = CLIENT_EXPORT_TABLE_ROW; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(row.getCell(c).text);
    out.push(cells);
  }
  return out;
}

const HEADER = [...CLIENT_EXPORT_HEADERS];
const WEEKLY_PERIOD = 'Sep 9, 2026 - Sep 15, 2026';

describe('buildClientWorkbook', () => {
  it('client scope: a Summary sheet first, then one sheet per account with rows', async () => {
    const wb = await workbookFor(SEED_CLIENT, 'Seed Client');
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Seed Account',
      'Seed Account Two',
    ]);
  });

  it('account scope: exactly one sheet, named for the account', async () => {
    const wb = await workbookFor(SEED_ACCOUNT_TWO, 'Seed Account Two');
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Seed Account Two']);
    expect(tableRows(wb.worksheets[0]!, HEADER.length)).toEqual([
      HEADER,
      ['Seed One-off', '', 'To-edge task', 'Reporting', 'Sep 15, 2026', 'In Progress', '—', ''],
    ]);
  });

  it('opens every sheet with the report title, the name it covers and the period', async () => {
    expect(reportPeriodLabel({ from: '2026-09-24', to: '2026-09-30' })).toBe(
      'Sep 24, 2026 - Sep 30, 2026',
    );

    const wb = await workbookFor(SEED_CLIENT, 'Seed Client');
    expect(headerRows(wb.getWorksheet('Summary')!)).toEqual({
      lines: ['Weekly report', 'Seed Client', WEEKLY_PERIOD],
      spacerBlank: true,
    });
    expect(headerRows(wb.getWorksheet('Seed Account')!)).toEqual({
      lines: ['Weekly report', 'Seed Account', WEEKLY_PERIOD],
      spacerBlank: true,
    });

    const monthly = await roundTrip({
      rows: await getClientExportRows(RANGE, SEED_ACCOUNT_TWO),
      scope: { kind: 'account', name: 'Seed Account Two' },
      period: 'monthly',
      range: { from: '2026-08-17', to: '2026-09-15' },
      now: NOW,
    });
    expect(headerRows(monthly.worksheets[0]!).lines).toEqual([
      'Monthly report',
      'Seed Account Two',
      'Aug 17, 2026 - Sep 15, 2026',
    ]);
  });

  it('summarizes each account: completed (approved + completed), in progress, total time', async () => {
    const wb = await workbookFor(SEED_CLIENT, 'Seed Client');
    expect(tableRows(wb.getWorksheet('Summary')!, CLIENT_EXPORT_SUMMARY_HEADERS.length)).toEqual([
      [...CLIENT_EXPORT_SUMMARY_HEADERS],
      // 1 approved + 1 completed; 1 in progress; 2.5h + 1.25h (the in-progress task has none).
      ['Seed Account', '2', '1', '3h 45m'],
      ['Seed Account Two', '0', '1', '0m'],
    ]);
  });

  it('renders every task cell through the UI formatters, with approved relabeled "Completed"', async () => {
    const seedWb = await workbookFor(SEED_CLIENT, 'Seed Client');
    expect(tableRows(seedWb.getWorksheet('Seed Account')!, HEADER.length)).toEqual([
      HEADER,
      [
        'Seed Retainer',
        'Month 9 — September',
        'From-edge task',
        'Content',
        'Sep 9, 2026',
        'In Progress',
        '—',
        '',
      ],
      [
        'Seed Retainer',
        'Month 9 — September',
        'Approved blog post',
        'Content',
        'Sep 10, 2026',
        'Completed', // approved → "Completed" for the client (§3.1.7)
        '2h 30m', // actual_hours NULL → the LATEST submission's 2.5h, not the older 9h
        'https://client.example.com/blog/post',
      ],
      [
        'Seed Retainer',
        'Month 9 — September',
        'Manager-closed audit',
        'Audit',
        'Sep 12, 2026',
        'Completed',
        '1h 15m', // actual_hours wins over the submission's 9h
        '',
      ],
    ]);

    const betaWb = await workbookFor(BETA_CLIENT, 'Beta Client');
    expect(tableRows(betaWb.getWorksheet('Beta Account')!, HEADER.length)).toEqual([
      HEADER,
      [
        'Beta Site',
        'Month 4 — September',
        'Beta outreach',
        'Link Building',
        'Sep 11, 2026',
        'In Progress',
        '45m',
        'Shared drive: /reports/sept',
      ],
    ]);
  });

  it('writes a web proof as a hyperlink, other proof text as plain text, and no summary', async () => {
    const deliverable = CLIENT_EXPORT_HEADERS.length;

    const seedWb = await workbookFor(SEED_CLIENT, 'Seed Client');
    // Table header on row 5, From-edge on 6, Approved on 7.
    const approved = seedWb
      .getWorksheet('Seed Account')!
      .getRow(CLIENT_EXPORT_TABLE_ROW + 2)
      .getCell(deliverable);
    expect(approved.hyperlink).toBe('https://client.example.com/blog/post');

    const betaWb = await workbookFor(BETA_CLIENT, 'Beta Client');
    const beta = betaWb
      .getWorksheet('Beta Account')!
      .getRow(CLIENT_EXPORT_TABLE_ROW + 1)
      .getCell(deliverable);
    expect(beta.hyperlink).toBeUndefined();
    expect(beta.value).toBe('Shared drive: /reports/sept');

    for (const wb of [seedWb, betaWb]) {
      for (const sheet of wb.worksheets) {
        sheet.eachRow((row) => {
          row.eachCell((cell) => expect(cell.text).not.toMatch(/INTERNAL|Seed Employee|urgent/i));
        });
      }
    }
  });

  it('keeps sheet names unique: an account named "Summary" does not collide with the Summary sheet', async () => {
    const rows = await getClientExportRows(RANGE, SEED_CLIENT);
    const renamed = rows.map((r) =>
      r.accountId === 'seed_account' ? { ...r, accountName: 'summary' } : r,
    );
    const wb = await roundTrip({
      rows: renamed,
      scope: { kind: 'client', name: 'Seed Client' },
      period: 'weekly',
      range: RANGE,
      now: NOW,
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'summary (2)',
      'Seed Account Two',
    ]);
  });

  it('produces an empty workbook for no rows (the route answers { empty: true } instead)', () => {
    const wb = buildClientWorkbook({
      rows: [],
      scope: { kind: 'client', name: 'Seed Client' },
      period: 'weekly',
      range: RANGE,
      now: NOW,
    });
    expect(wb.worksheets).toHaveLength(0);
  });
});

describe('sheetNameFor', () => {
  it('strips illegal characters, truncates to 31 and de-dupes case-insensitively', () => {
    const taken = new Set<string>();
    expect(sheetNameFor('Acme: [Global]/Holdings?', taken)).toBe('Acme Global Holdings');
    expect(sheetNameFor('ACME GLOBAL HOLDINGS', taken)).toBe('ACME GLOBAL HOLDINGS (2)');
    const long = 'A Very Long Client Name That Exceeds Excel';
    const first = sheetNameFor(long, taken);
    expect(first).toBe('A Very Long Client Name That Ex');
    expect(first).toHaveLength(31);
    // A second account with the same long name: the base is truncated so the suffix still fits.
    expect(sheetNameFor(long, taken)).toBe('A Very Long Client Name Tha (2)');
    expect(sheetNameFor("''", taken)).toBe('Account');
  });
});

describe('clientExportFilename', () => {
  it('is <slug>-<period>-report-<today>.xlsx, slugging the client or account name', () => {
    expect(clientExportFilename('Seed Client', 'weekly', '2026-09-15')).toBe(
      'seed-client-weekly-report-2026-09-15.xlsx',
    );
    expect(clientExportFilename('  Café & Bäckerei: Nord ', 'monthly', '2026-09-15')).toBe(
      'cafe-backerei-nord-monthly-report-2026-09-15.xlsx',
    );
    expect(clientExportFilename('???', 'weekly', '2026-09-15')).toBe(
      'report-weekly-report-2026-09-15.xlsx',
    );
  });
});

// ── The route handler (PUL-418.1) ─────────────────────────────────────────────────────────

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

function get(query: string) {
  return clientExportResponse(new Request(`http://test.local/api/export/client-tasks?${query}`));
}

function filenameOf(res: Response): string | null {
  return /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? null;
}

describe('GET /api/export/client-tasks', () => {
  it('400 for a bad period, or for neither / both of clientId and accountId', async () => {
    actAs(seed.projectManager.id);
    for (const query of [
      'period=daily&clientId=seed_client',
      'clientId=seed_client',
      'period=weekly',
      'period=weekly&clientId=&accountId=',
      'period=weekly&clientId=seed_client&accountId=seed_account',
    ]) {
      expect((await get(query)).status, query).toBe(400);
    }
  });

  it('403 for no session, a non-manager or a deactivated manager, before any existence check', async () => {
    getSession.mockResolvedValue(null);
    expect((await get('period=weekly&clientId=seed_client')).status).toBe(403);

    actAs(seed.employees[0].id);
    expect((await get('period=weekly&clientId=seed_client')).status).toBe(403);
    // An unknown id still answers 403, not 404: a non-manager cannot probe which ids exist.
    expect((await get('period=weekly&clientId=nope')).status).toBe(403);

    await db.update(user).set({ active: false }).where(eq(user.id, seed.teamLeader.id));
    actAs(seed.teamLeader.id);
    expect((await get('period=weekly&clientId=seed_client')).status).toBe(403);
  });

  it('404 for an unknown or archived client or account', async () => {
    actAs(seed.projectManager.id);
    expect((await get('period=weekly&clientId=nope')).status).toBe(404);
    expect((await get('period=weekly&accountId=nope')).status).toBe(404);

    await db.update(accounts).set({ deletedAt: NOW }).where(eq(accounts.id, 'seed_account_2'));
    expect((await get('period=weekly&accountId=seed_account_2')).status).toBe(404);

    await db.update(clients).set({ deletedAt: NOW }).where(eq(clients.id, 'client_beta'));
    expect((await get('period=weekly&clientId=client_beta')).status).toBe(404);
    // An account under an archived client is not reportable either.
    expect((await get('period=weekly&accountId=acct_beta')).status).toBe(404);
  });

  it('client scope: the .xlsx, named for the client, with Summary + a sheet per account', async () => {
    actAs(seed.projectManager.id);
    const res = await get('period=weekly&clientId=seed_client');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(filenameOf(res)).toBe('seed-client-weekly-report-2026-09-15.xlsx');

    const wb = await load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Seed Account',
      'Seed Account Two',
    ]);
    expect(wb.title).toBe('Seed Client');
  });

  it('account scope: one sheet, named for the account, and the monthly filename', async () => {
    actAs(seed.projectManager.id);
    const res = await get('period=monthly&accountId=seed_account_2');

    expect(res.status).toBe(200);
    expect(filenameOf(res)).toBe('seed-account-two-monthly-report-2026-09-15.xlsx');
    const wb = await load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Seed Account Two']);
    expect(headerRows(wb.worksheets[0]!).lines).toEqual([
      'Monthly report',
      'Seed Account Two',
      'Aug 17, 2026 - Sep 15, 2026',
    ]);
  });

  it('answers { empty: true } for a live scope with nothing in the period', async () => {
    actAs(seed.projectManager.id);
    await db.insert(clients).values({ id: 'client_quiet', name: 'Quiet Client' });

    const res = await get('period=weekly&clientId=client_quiet');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ empty: true });
  });
});

// ── PUL-418.6: white-label ────────────────────────────────────────────────────────────────

/**
 * Every entry of a .xlsx (a zip) as text. A minimal reader over Node's zlib: jszip is only a
 * transitive dependency here and pnpm will not resolve it from the project root. Enough for the
 * files exceljs writes (no zip64, stored or deflated entries).
 */
function unzipText(buffer: Buffer): Map<string, string> {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(p + 10);
    const size = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);

    const dataStart =
      local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const AGENCY = /easygrow/i;

describe('white-label (PUL-418.6)', () => {
  it('names the agency nowhere: cells, sheet names, filename, properties, or any file part', async () => {
    actAs(seed.projectManager.id);

    for (const query of [
      'period=weekly&clientId=seed_client',
      'period=monthly&accountId=seed_account',
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(200);

      expect(filenameOf(res), query).not.toMatch(AGENCY);

      const buffer = Buffer.from(await res.arrayBuffer());
      const wb = await load(buffer);

      for (const sheet of wb.worksheets) {
        expect(sheet.name).not.toMatch(AGENCY);
        sheet.eachRow({ includeEmpty: true }, (row) => {
          row.eachCell({ includeEmpty: true }, (cell) => expect(cell.text).not.toMatch(AGENCY));
        });
      }

      const props = {
        creator: wb.creator,
        lastModifiedBy: wb.lastModifiedBy,
        company: wb.company,
        title: wb.title,
        subject: wb.subject,
        keywords: wb.keywords,
        category: wb.category,
        description: wb.description,
        manager: wb.manager,
      };
      for (const [key, value] of Object.entries(props)) {
        expect(value ?? '', `${query}: ${key}`).not.toMatch(AGENCY);
      }

      // Belt and braces: every byte of every part of the file, docProps included.
      const parts = unzipText(buffer);
      expect(parts.has('docProps/core.xml')).toBe(true);
      for (const [name, text] of parts) expect(text, `${query}: ${name}`).not.toMatch(AGENCY);
    }
  });
});
