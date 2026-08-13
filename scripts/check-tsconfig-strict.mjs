#!/usr/bin/env node
// Regression guard for the "strict not inheriting from tsconfig.base.json"
// DX bug (external report): every tsconfig.json in the repo must resolve
// `strict: true` in its EFFECTIVE (post-`extends`) compiler options —
// including the root solution-style tsconfig.json, whose `compilerOptions`
// used to be entirely absent. That mattered because tsserver/IDE project
// resolution walks UP from any open file to the nearest tsconfig.json; for
// files with no home of their own (e2e/**, playwright.config.ts,
// vitest.config.ts, scripts/**), that nearest file IS the root
// tsconfig.json — so a root config with no `extends` silently opted those
// files out of strict mode even though tsconfig.base.json declares it.
//
// This walks every tsconfig*.json in the repo (skipping node_modules/dist/
// vendor/.git, and tsconfig.base.json itself — it's the source of truth,
// not a consumer) and resolves each one's EFFECTIVE options the same way
// TypeScript itself does (`ts.readConfigFile` + `ts.parseJsonConfigFileContent`,
// which follows `extends` chains), asserting `strict === true`.
//
// Usage: node scripts/check-tsconfig-strict.mjs [rootDir]
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "vendor"]);

function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/**
 * Finds every tsconfig*.json under rootDir except tsconfig.base.json (the
 * source of truth being asserted against, not a consumer of it).
 */
export function findTsconfigs(rootDir) {
  return walk(rootDir, (f) => f.endsWith(".json") && /(^|\/)tsconfig(\..+)?\.json$/.test(f) && !f.endsWith("tsconfig.base.json")).sort();
}

/**
 * Resolves a tsconfig's EFFECTIVE compiler options (following `extends`,
 * exactly as `tsc`/tsserver do) and reports whether `strict` is on.
 */
export function checkStrict(configPath) {
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) {
    return { configPath, ok: false, reason: ts.flattenDiagnosticMessageText(raw.error.messageText, "\n") };
  }
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, dirname(configPath));
  if (parsed.errors.length > 0) {
    return {
      configPath,
      ok: false,
      reason: parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ")
    };
  }
  return { configPath, ok: parsed.options.strict === true, strict: parsed.options.strict };
}

export function runCheck(rootDir) {
  const configs = findTsconfigs(rootDir);
  const results = configs.map(checkStrict);
  const failures = results.filter((r) => !r.ok);
  return { rootDir, configs, results, failures };
}

function printReport(report) {
  const { rootDir, results, failures } = report;
  console.log(`check-tsconfig-strict: ${results.length} tsconfig(s) checked for effective strict:true.`);
  if (failures.length > 0) {
    console.error(`\nErrors (${failures.length}):`);
    for (const f of failures) {
      const rel = relative(rootDir, f.configPath);
      const detail = f.reason ?? `strict resolved to ${JSON.stringify(f.strict)}, expected true`;
      console.error(`  - ${rel}: ${detail}`);
    }
    console.error("\ncheck-tsconfig-strict: FAILED");
  } else {
    console.log("check-tsconfig-strict: OK");
  }
}

function isMain() {
  return process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const rawArgs = process.argv.slice(2);
  const rootDir = rawArgs[0] ? resolve(process.cwd(), rawArgs[0]) : process.cwd();
  const report = runCheck(rootDir);
  printReport(report);
  process.exit(report.failures.length > 0 ? 1 : 0);
}
