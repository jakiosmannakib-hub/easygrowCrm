// tests/setup-db.ts
//
// Points every test at easygrowcrm_test, never the dev database.
//
// This runs as a vitest `setupFiles` entry, i.e. BEFORE any test imports db/index.ts.
// That ordering is what makes it work: db/index.ts does `import "dotenv/config"`, and
// dotenv does NOT override an already-set variable — so whatever we set here wins over
// the DATABASE_URL in .env.
//
// Minimal by design. PUL-109 formalizes fixtures with seedMinimal / seedFull.

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://easygrowcrm:easygrowcrm_dev@localhost:5432/easygrowcrm_test';
