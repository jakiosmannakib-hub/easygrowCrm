import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import authorizeFirst from "./eslint-rules/authorize-first.mjs";

/**
 * The local plugin holding this project's own rules (PUL-105.3).
 * File scoping lives in the `files` glob below, so the rules stay simple.
 */
const easygrowcrm = {
  rules: {
    "authorize-first": authorizeFirst,
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
