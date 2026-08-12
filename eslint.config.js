// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Minimal, non-type-aware lint config for M0: catches obvious mistakes
// (unused vars, undefined globals, etc.) in TS packages and the Node
// tooling scripts without pulling in a type-checked project service, which
// is unnecessary now that `pnpm build` (tsc -b, strict mode) already covers
// full type safety. Revisit (type-aware rules, per-package overrides) once
// packages beyond engine-api/contract-tests exist.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "vendor/**"]
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["scripts/**/*.mjs", "packages/*/scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
      globals: globals.node
    }
  },
  {
    // scripts/capture-landing-screenshots.mjs runs under Node overall, but
    // its `page.evaluate(() => ...)` callbacks execute IN the browser page
    // (document/window/getComputedStyle/DOMMatrixReadOnly) — combine both
    // global sets for this one file rather than the plain Node-only set
    // above.
    files: ["scripts/capture-landing-screenshots.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    // packages/app runs in the browser (Vite + React) — DOM globals only,
    // no Node globals, unlike the scripts/**/*.mjs block above.
    files: ["packages/app/**/*.{ts,tsx}"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
      globals: globals.browser
    }
  }
);
