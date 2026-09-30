// features/projects/client-export.test.ts — PUL-413.3
//
// The client-safe Weekly / Monthly Excel export (§3.1.7 / §6.3 / §13.8). What it pins:
//
//   - `getClientExportRows` returns EXACTLY the expected rows for a fixed range: the three
//     client statuses only, `client_visible` only, both range edges inclusive, soft-deleted
//     work out, and no internal field (assignee, priority, comments, submission summary) on
//     any row.
//   - `buildClientWorkbook` writes one sheet per client, relabels `approved` as "Completed",
//     falls back from `actual_hours` to the latest submission's hours, and writes the proof
//     link and nothing else in the Deliverable column.
//
// Rig: the real easygrowcrm_test database, no DB mocks (§15.8). The query does no session read
// (the MGR gate is the route's), so nothing is stubbed.

import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { accounts, clients, projects, projectTasks, taskSubmissions } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createTestClock, resetClock, setClock } from '../../lib/clock';
import { dhakaToday } from '../../lib/format';
import { seedFull, type FullSeed } from '../../tests/seed';
import {
  buildClientWorkbook,
  CLIENT_EXPORT_HEADERS,
  clientExportRange,
  sheetNameFor,
} from './client-export';
import { getClientExportRows, type ClientExportRow } from './queries';

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
  await db.insert(accounts).values({ id: 'acct_beta', clientId: 'client_beta', name: 'Beta Account' });
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
});

const EXPECTED: ClientExportRow[] = [
  {
    clientId: 'client_beta',
    clientName: 'Beta Client',
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
  {
    clientId: 'seed_client',
    clientName: 'Seed Client',
    projectName: 'Seed One-off',
    projectStartDate: '2026-03-01',
    month: null,
    title: 'To-edge task',
    category: 'Reporting',
    dueDate: '2026-09-15',
    status: 'in_progress',
    timeSpentHours: null,
    proofUrl: null,
  },
  {
    clientId: 'seed_client',
    clientName: 'Seed Client',
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
    clientId: 'seed_client',
    clientName: 'Seed Client',
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
    clientId: 'seed_client',
    clientName: 'Seed Client',
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
];

/** Every key a row may carry. Anything else on a row is a leak. */
const CLIENT_SAFE_KEYS = [
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
  it('returns exactly the client-safe rows for the range, in client → project → due order', async () => {
    expect(await getClientExportRows(RANGE)).toEqual(EXPECTED);
  });

  it('never carries an internal field: no assignee, priority, comments or submission notes', async () => {
    const rows = await getClientExportRows(RANGE);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(CLIENT_SAFE_KEYS);

    // The fixture put INTERNAL text in every internal column; none of it may surface anywhere.
    expect(JSON.stringify(rows)).not.toMatch(/INTERNAL|urgent|seed_e1|seed_tl/);
  });

  it('excludes submitted / blocked / cancelled / planned / revision, hidden, out-of-range and deleted', async () => {
    const titles = (await getClientExportRows(RANGE)).map((r) => r.title);
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
      await expect(getClientExportRows(bad)).rejects.toSatisfy(
        (e: unknown) => e instanceof AppError && e.code === 'VALIDATION',
      );
    }
  });
});

describe('buildClientWorkbook', () => {
  /** Serialize and reload, so the assertions are about the real .xlsx and not the in-memory model. */
  async function roundTrip() {
    const buffer = await buildClientWorkbook(await getClientExportRows(RANGE)).xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    return wb;
  }

  /** A sheet's rows as plain text values, header first. */
  function textRows(sheet: ExcelJS.Worksheet): string[][] {
    const out: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      for (let c = 1; c <= CLIENT_EXPORT_HEADERS.length; c++) cells.push(row.getCell(c).text);
      out.push(cells);
    });
    return out;
  }

  it('writes one sheet per client that has rows, named for the client', async () => {
    const wb = await roundTrip();
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Beta Client', 'Seed Client']);
  });

  it('renders every cell through the UI formatters, with approved relabeled "Completed"', async () => {
    const wb = await roundTrip();
    const header = [...CLIENT_EXPORT_HEADERS];

    expect(textRows(wb.getWorksheet('Beta Client')!)).toEqual([
      header,
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

    expect(textRows(wb.getWorksheet('Seed Client')!)).toEqual([
      header,
      ['Seed One-off', '', 'To-edge task', 'Reporting', 'Sep 15, 2026', 'In Progress', '—', ''],
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
  });

  it('writes a web proof as a hyperlink, other proof text as plain text, and no summary', async () => {
    const wb = await roundTrip();
    const deliverable = CLIENT_EXPORT_HEADERS.length;

    const approved = wb.getWorksheet('Seed Client')!.getRow(4).getCell(deliverable);
    expect(approved.hyperlink).toBe('https://client.example.com/blog/post');

    const beta = wb.getWorksheet('Beta Client')!.getRow(2).getCell(deliverable);
    expect(beta.hyperlink).toBeUndefined();
    expect(beta.value).toBe('Shared drive: /reports/sept');

    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => expect(cell.text).not.toMatch(/INTERNAL|Seed Employee|urgent/i));
      });
    }
  });

  it('produces an empty workbook for no rows (the route answers { empty: true } instead)', () => {
    expect(buildClientWorkbook([]).worksheets).toHaveLength(0);
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
    // A second client with the same long name: the base is truncated so the suffix still fits.
    expect(sheetNameFor(long, taken)).toBe('A Very Long Client Name Tha (2)');
    expect(sheetNameFor("''", taken)).toBe('Client');
  });
});
