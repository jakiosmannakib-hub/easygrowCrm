import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import authorizeFirst from "./eslint-rules/authorize-first.mjs";
import noDirectDate from "./eslint-rules/no-direct-date.mjs";

/**
 * The local plugin holding this project's own rules (PUL-105.3).
 * File scoping lives in the `files` glob below, so the rules stay simple.
 */
const easygrowcrm = {
  rules: {
    "authorize-first": authorizeFirst,
    "no-direct-date": noDirectDate,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["features/**/actions.ts"],
    plugins: { easygrowcrm },
    rules: {
      "easygrowcrm/authorize-first": "error",
    },
  },
  {
    // Broader than authorize-first: any feature code, not just actions.ts (PUL-108.2).
    // lib/clock.ts — the adapter — is outside this glob, so it keeps its new Date().
    files: ["features/**"],
    plugins: { easygrowcrm },
    rules: {
      "easygrowcrm/no-direct-date": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
