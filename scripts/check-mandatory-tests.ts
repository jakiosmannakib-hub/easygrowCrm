/**
 * Fails CI if any test file listed in MANDATORY_TEST_FILES is missing.
 * The list starts empty and grows as each phase adds required tests (§15.4).
 * See PRD §15.9 gate 5.
 */
import { existsSync } from 'node:fs';

// Paths are relative to the repo root. Add required test files here per phase.
const MANDATORY_TEST_FILES: string[] = [
  // e.g. 'features/attendance/attendance.contract.test.ts',
];

const missing = MANDATORY_TEST_FILES.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error('Missing mandatory test files:');
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`Mandatory test check passed (${MANDATORY_TEST_FILES.length} required file(s)).`);
