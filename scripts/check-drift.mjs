#!/usr/bin/env node
// P0 drift detector (see specs/README.md's "Drift detection" section).
//
// Fails (non-zero exit / non-empty `errors`) on:
//   (a) a test citing a requirement ID that doesn't exist in any specs/*.md
//       file, or that exists but is `retired`.
//   (b) a spec file with a malformed requirement-line-shaped line (starts
//       like `- [ID] (...)` but doesn't match the full format).
//   (c) (CI PR context only, i.e. GITHUB_BASE_REF is set) a file under an
//       specs/ownership.json glob changed vs the PR's base branch without a
//       spec file changing in the same diff. Skipped on plain `push` builds
//       and always skipped locally (no base ref to diff against).
//
// Orphan active requirements (zero citing tests) are WARN-only for now.
// ORPHAN_CHECK: flip this to a hard failure on a per-module basis once that
// module's implementation slice lands (there is no implementation to cite
// requirements against yet at M0, so failing on orphans today would fail
// every requirement in the repo).
//
// Usage: node scripts/check-drift.mjs [rootDir]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

const REQ_LINE_RE =
  /^-\s+\[([A-Z]{2,6}-\d{3,4})\]\s+\((active|retired|changed-in:#\d+)\)\s+(.+)$/;
const REQ_LOOKALIKE_RE = /^-\s*\[[^\]]*\]/;
const ID_TOKEN_RE = /\b([A-Z]{2,6}-\d{3,4})\b/g;
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
 * Parses every specs/*.md file (except README.md, which documents the
 * format rather than declaring requirements) into a requirement registry
 * plus a list of malformed requirement-line-shaped lines.
 */
export function parseSpecs(specsDir) {
  const registry = new Map(); // id -> { status, statement, file, line }
  const malformed = [];
  if (!existsSync(specsDir)) return { registry, malformed };

  const files = readdirSync(specsDir).filter(
    (f) => f.endsWith(".md") && f !== "README.md"
  );
  for (const file of files) {
    const text = readFileSync(join(specsDir, file), "utf8");
    text.split("\n").forEach((lineText, idx) => {
      if (!lineText.startsWith("- [")) return;
      const m = lineText.match(REQ_LINE_RE);
      if (m) {
        const [, id, status, statement] = m;
        if (registry.has(id)) {
          malformed.push({
            file,
            line: idx + 1,
            text: lineText,
            reason: `duplicate requirement id "${id}" (first seen in ${registry.get(id).file}:${registry.get(id).line})`
          });
        } else {
          registry.set(id, { status, statement, file, line: idx + 1 });
        }
      } else if (REQ_LOOKALIKE_RE.test(lineText)) {
        malformed.push({
          file,
          line: idx + 1,
          text: lineText,
          reason: "does not match the requirement line format `- [ID] (status) statement`"
        });
      }
    });
  }
  return { registry, malformed };
}

/**
 * Scans every *.test.{ts,mjs,js} file under rootDir/packages for
 * requirement-ID-shaped tokens, in either a test title string or an
 * `@spec ID` docblock (both are just text as far as this scan is
 * concerned; see specs/README.md). Deliberately scoped to packages/ rather
 * than the whole repo: scripts/*.test.mjs are this tooling's OWN self-tests
 * (e.g. scripts/drift.test.mjs), and their fixture strings intentionally
 * contain ID-shaped tokens (including deliberately-unknown/retired/
 * malformed ones) that must never be mistaken for real citations.
 */
export function scanTestCitations(rootDir) {
  const scanRoot = existsSync(join(rootDir, "packages")) ? join(rootDir, "packages") : rootDir;
  const testFiles = walk(scanRoot, (f) => {
    if (/\.test\.(ts|mjs|js)$/.test(f)) return true;
    // contract-tests' describe-factory modules (render-host.ts etc.) ARE the
    // test-obligation source of truth: their `it.todo(obligation)` titles
    // come from an exported `*ContractObligations` array, not a string
    // literal at the it.todo() call site, so a *.test.* filename filter
    // alone would miss them entirely. Every source file in that one package
    // is treated as citation-bearing; nothing else gets this exception.
    const rel = relative(scanRoot, f).split(sep).join("/");
    return /^contract-tests\/src\/.*\.ts$/.test(rel);
  });
  const citations = new Map(); // id -> Set<relative file path>
  for (const file of testFiles) {
    const text = readFileSync(file, "utf8");
    const rel = relative(rootDir, file);
    ID_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = ID_TOKEN_RE.exec(text))) {
      const id = m[1];
      if (!citations.has(id)) citations.set(id, new Set());
      citations.get(id).add(rel);
    }
  }
  return citations;
}

/** Minimal glob->RegExp: supports `*` (single segment) and `**` (any depth). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") i++;
        re += ".*";
      } else {
        re += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function checkOwnershipDrift(rootDir, ownership, baseRef) {
  if (!baseRef) {
    return { errors: [], skippedReason: "no GITHUB_BASE_REF set (not a PR build) — skipped" };
  }
  const globEntries = Object.entries(ownership).filter(([k]) => !k.startsWith("$"));
  const diffRange = `origin/${baseRef}...HEAD`;
  const diff = spawnSync("git", ["diff", "--name-only", diffRange], {
    cwd: rootDir,
    encoding: "utf8"
  });
  if (diff.status !== 0) {
    return {
      errors: [],
      skippedReason: `\`git diff ${diffRange}\` failed (${(diff.stderr || "").trim() || diff.error}); skipping ownership check`
    };
  }
  const changed = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const changedSpecFiles = new Set(
    changed.filter((f) => f.startsWith("specs/") && f.endsWith(".md")).map((f) => f.slice("specs/".length))
  );

  const requiredSpecs = new Map(); // specFile (relative to specs/) -> triggering file[]
  for (const file of changed) {
    if (file.startsWith("specs/")) continue;
    for (const [glob, specFile] of globEntries) {
      if (globToRegExp(glob).test(file)) {
        const key = specFile.startsWith("specs/") ? specFile.slice("specs/".length) : specFile;
        if (!requiredSpecs.has(key)) requiredSpecs.set(key, []);
        requiredSpecs.get(key).push(file);
      }
    }
  }

  const errors = [];
  for (const [specFile, files] of requiredSpecs) {
    if (!changedSpecFiles.has(specFile)) {
      errors.push(
        `Ownership drift: ${files.join(", ")} changed under an owned path but specs/${specFile} ` +
          `did not change in this PR. (OPEN(P0-nospec-label-tbd): the plan's "no-spec-impact" label ` +
          "bypass isn't wired yet — for now, touch the spec file, even trivially, to unblock.)"
      );
    }
  }
  return { errors, skippedReason: null };
}

/**
 * Runs the full drift check against rootDir. `ci: true` additionally runs
 * the ownership-drift check (itself a no-op unless GITHUB_BASE_REF is set).
 */
export function runCheck(rootDir, { ci = false } = {}) {
  const { registry, malformed } = parseSpecs(join(rootDir, "specs"));
  const citations = scanTestCitations(rootDir);

  const errors = [];
  const warnings = [];
  let ownershipSkippedReason = null;

  for (const m of malformed) {
    errors.push(`Malformed requirement line at specs/${m.file}:${m.line}: ${m.reason}\n    "${m.text}"`);
  }

  for (const [id, files] of citations) {
    const info = registry.get(id);
    const citing = [...files].sort().join(", ");
    if (!info) {
      errors.push(`Unknown requirement ID "${id}" cited by: ${citing}`);
    } else if (info.status === "retired") {
      errors.push(`Retired requirement ID "${id}" (specs/${info.file}) cited by: ${citing}`);
    }
  }

  for (const [id, info] of registry) {
    if (info.status === "active" && !citations.has(id)) {
      warnings.push(`Orphan active requirement ${id} (specs/${info.file}:${info.line}) has no citing test.`);
    }
  }

  if (ci) {
    const ownershipPath = join(rootDir, "specs", "ownership.json");
    if (existsSync(ownershipPath)) {
      const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
      const result = checkOwnershipDrift(rootDir, ownership, process.env.GITHUB_BASE_REF);
      errors.push(...result.errors);
      ownershipSkippedReason = result.skippedReason;
    }
  } else {
    ownershipSkippedReason = "not running in CI PR mode ({ ci: true } not passed) — skipped";
  }

  return { errors, warnings, registry, citations, ownershipSkippedReason };
}

function printReport(report) {
  const { errors, warnings, registry, citations, ownershipSkippedReason } = report;
  console.log(`check-drift: ${registry.size} requirement(s) across specs/*.md, ${citations.size} distinct ID(s) cited by tests.`);
  if (ownershipSkippedReason) {
    console.log(`check-drift: ownership-drift check — ${ownershipSkippedReason}`);
  }
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length > 0) {
    console.error(`\nErrors (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\ncheck-drift: FAILED");
  } else {
    console.log("\ncheck-drift: OK");
  }
}

function isMain() {
  return process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const rootDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : process.cwd();
  const ci = Boolean(process.env.GITHUB_BASE_REF);
  const report = runCheck(rootDir, { ci });
  printReport(report);
  process.exit(report.errors.length > 0 ? 1 : 0);
}
