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
];

const missing = MANDATORY_TEST_FILES.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error('Missing mandatory test files:');
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`Mandatory test check passed (${MANDATORY_TEST_FILES.length} required file(s)).`);
