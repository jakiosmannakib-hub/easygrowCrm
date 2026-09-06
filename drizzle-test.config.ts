import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Test-database config. Same schema and migrations as drizzle.config.ts; only the
// target differs. Kept separate so `pnpm test:db:reset` can migrate the test DB
// cross-platform without inline env-var syntax (PowerShell vs. sh differ).
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url:
      process.env.TEST_DATABASE_URL ??
      'postgresql://easygrowcrm:easygrowcrm_dev@localhost:5432/easygrowcrm_test',
  },
  strict: true,
  verbose: true,
});
