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
];

const missing = MANDATORY_TEST_FILES.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error('Missing mandatory test files:');
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`Mandatory test check passed (${MANDATORY_TEST_FILES.length} required file(s)).`);
