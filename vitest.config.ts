import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Tests share one real Postgres database and TRUNCATE between cases, so files
    // must not run in parallel (§15.7 — real DB, no mocks).
    fileParallelism: false,
    // Must run before any db import so DATABASE_URL points at easygrowcrm_test.
    setupFiles: ['./tests/setup-db.ts'],
  },
});
