import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Must run before any db import so DATABASE_URL points at easygrowcrm_test.
    setupFiles: ['./tests/setup-db.ts'],
  },
});
