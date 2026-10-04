/**
 * Fails CI if any test file listed in MANDATORY_TEST_FILES is missing.
 * The list starts empty and grows as each phase adds required tests (§15.4).
 * See PRD §15.9 gate 5.
 */
import { existsSync } from 'node:fs';

// Paths are relative to the repo root. Add required test files here per phase.
const MANDATORY_TEST_FILES: string[] = [
  'features/auth/session-from-google.test.ts', // PUL-103.5
  'features/audit/audit-write.test.ts', // PUL-102.4
  'features/audit/audit-immutability.test.ts', // PUL-102.4
  'features/auth/authorize.test.ts', // PUL-104.3
  'features/employees/min-two-managers.test.ts', // PUL-201.3
  'features/employees/create-employee.test.ts', // PUL-202.4
  'features/employees/update-employee.test.ts', // PUL-203.3
  'features/employees/role-change.test.ts', // PUL-204.3
  'features/employees/deactivate.test.ts', // PUL-205.5
  'features/employees/reactivate.test.ts', // PUL-206 Stage 3 (§13.1.5)
  'features/employees/action-result-boundary.test.ts', // PUL-111
  'features/clients/clients.test.ts', // PUL-207.4
  'features/auth/oauth-link-provisioned.test.ts', // ACCOUNT_NOT_LINKED regression (PUL-202 "Done when")
  'features/projects/assign.test.ts', // PUL-403.5 — SA never assignable, app + DB trigger
  'features/projects/status-transitions.test.ts', // PUL-404.6 — legal + illegal transitions per role
  'features/projects/client-export.test.ts', // PUL-413.3 — client-safe export rows + workbook
  'features/templates/hierarchy-walker.test.ts', // PUL-502.2 — tplAllTasks visits every task once, in order
  'features/templates/template-actions.test.ts', // PUL-503 — hierarchy CRUD, bad_ref + dependents gates, diff audit
  'features/templates/template-meta.test.ts', // PUL-503 Stage 2 — card/header counts via tplAllTasks
  'features/templates/task-form.test.ts', // PUL-503 Stage 3b — checklist parse + task form conversion
  'features/templates/cascade.test.ts', // PUL-504 — 12-month cascade dates, Feb at 29
  'features/templates/due-rule-compute.test.ts', // PUL-505.3 — day / before_deadline / after + working-day shifts
  'features/templates/start-project.test.ts', // PUL-506.4 — clone: tokens, subtasks, checklist, due dates, depends_on
  'features/clients/accounts.test.ts', // PUL-415.6 — account CRUD, account_in_use + amended client_in_use gates, audit, authz
  'features/projects/qc-required-check.test.ts', // PUL-416.4: qc_required = false refused on both tables, 0010 backfill re-runnable
  'features/attendance/sign-in.test.ts', // PUL-302.5: on time / late / weekend / holiday / CONFLICT / plan + prefill
  'features/attendance/schema.test.ts', // PUL-301: attendance/break/EOD/settings DB rules, EOD immutability trigger
];

const missing = MANDATORY_TEST_FILES.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error('Missing mandatory test files:');
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`Mandatory test check passed (${MANDATORY_TEST_FILES.length} required file(s)).`);
