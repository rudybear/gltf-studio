#!/usr/bin/env node
// Self-test for scripts/check-drift.mjs: seeds a temp fixture repo per
// violation class check-drift.mjs claims to catch, and asserts it does.
// Run with `node --test scripts/drift.test.mjs` (also wired as
// `pnpm drift:selftest` and a CI step).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { runCheck } from "./check-drift.mjs";

const CHECK_DRIFT_PATH = fileURLToPath(new URL("./check-drift.mjs", import.meta.url));

const tmpDirs = [];

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "gltf-studio-drift-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
  return result.stdout;
}

after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test("clean fixture: no errors, no warnings when every requirement is cited", () => {
  const root = makeFixture();
  writeFile(root, "specs/engine-api.md", "- [RH-001] (active) Example statement.\n");
  writeFile(root, "packages/foo/src/foo.test.ts", 'it("does the thing (RH-001)", () => {});\n');

  const report = runCheck(root, { ci: false });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.equal(report.warnings.length, 0, report.warnings.join("\n"));
});

test("class (a-i): a test citing an unknown requirement ID fails", () => {
  const root = makeFixture();
  writeFile(root, "specs/engine-api.md", "- [RH-001] (active) Example statement.\n");
  writeFile(root, "packages/foo/src/foo.test.ts", 'it("does the thing (RH-999)", () => {});\n');

  const report = runCheck(root, { ci: false });
  assert.ok(
    report.errors.some((e) => e.includes('Unknown requirement ID "RH-999"')),
    `expected an "unknown ID" error, got:\n${report.errors.join("\n")}`
  );
});

test("class (a-ii): a test citing a retired requirement ID fails", () => {
  const root = makeFixture();
  writeFile(root, "specs/engine-api.md", "- [RH-002] (retired) Old statement, superseded.\n");
  writeFile(root, "packages/foo/src/foo.test.ts", 'it("still does the old thing (RH-002)", () => {});\n');

  const report = runCheck(root, { ci: false });
  assert.ok(
    report.errors.some((e) => e.includes('Retired requirement ID "RH-002"')),
    `expected a "retired ID" error, got:\n${report.errors.join("\n")}`
  );
});

test("class (b): a malformed requirement line fails", () => {
  const root = makeFixture();
  // Lowercase ID and a capitalized, unrecognized status word — looks like a
  // requirement line but doesn't match the format in specs/README.md.
  writeFile(root, "specs/engine-api.md", "- [rh-003] (Active) Malformed on purpose.\n");

  const report = runCheck(root, { ci: false });
  assert.ok(
    report.errors.some((e) => e.includes("Malformed requirement line")),
    `expected a "malformed requirement line" error, got:\n${report.errors.join("\n")}`
  );
});

test("orphan active requirement warns but does not fail", () => {
  const root = makeFixture();
  writeFile(root, "specs/engine-api.md", "- [RH-004] (active) Nobody cites this yet.\n");

  const report = runCheck(root, { ci: false });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.ok(
    report.warnings.some((w) => w.includes("Orphan active requirement RH-004")),
    `expected an orphan warning, got:\n${report.warnings.join("\n")}`
  );
});

test("class (c): ownership drift — owned path changed without a spec diff fails in PR context", () => {
  const root = makeFixture();
  writeFile(root, "specs/ownership.json", JSON.stringify({ "packages/foo/**": "specs/engine-api.md" }, null, 2));
  writeFile(root, "specs/engine-api.md", "- [RH-005] (active) Owns packages/foo.\n");
  writeFile(root, "packages/foo/src/foo.ts", "export const x = 1;\n");

  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Drift Selftest"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  const baseSha = git(root, ["rev-parse", "HEAD"]).trim();
  // Simulate a fetched base branch (what actions/checkout leaves behind)
  // without needing a real remote.
  git(root, ["update-ref", "refs/remotes/origin/main", baseSha]);

  // Change the owned file WITHOUT touching specs/engine-api.md.
  writeFile(root, "packages/foo/src/foo.ts", "export const x = 2;\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "change foo without a spec diff"]);

  const previousBaseRef = process.env.GITHUB_BASE_REF;
  process.env.GITHUB_BASE_REF = "main";
  try {
    const report = runCheck(root, { ci: true });
    assert.ok(
      report.errors.some((e) => e.includes("Ownership drift") && e.includes("packages/foo/src/foo.ts")),
      `expected an "Ownership drift" error, got:\n${report.errors.join("\n")}`
    );
  } finally {
    if (previousBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = previousBaseRef;
  }
});

test("class (c): ownership drift — caught via --simulate-pr / baseRef option WITHOUT setting GITHUB_BASE_REF", () => {
  // GITHUB_BASE_REF is NOT a reliable "unset" precondition here: a real
  // GitHub Actions PR build (the exact context this whole flag exists to
  // let you simulate locally) legitimately sets it for every job in the
  // run, including this test suite. So — like the other GITHUB_BASE_REF
  // tests in this file — save/clear it for the duration of the test and
  // restore it in a finally, rather than asserting it starts undefined.
  const previousBaseRef = process.env.GITHUB_BASE_REF;
  delete process.env.GITHUB_BASE_REF;
  try {
    const root = makeFixture();
    writeFile(root, "specs/ownership.json", JSON.stringify({ "packages/foo/**": "specs/engine-api.md" }, null, 2));
    writeFile(root, "specs/engine-api.md", "- [RH-008] (active) Owns packages/foo.\n");
    writeFile(root, "packages/foo/src/foo.ts", "export const x = 1;\n");

    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Drift Selftest"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "base"]);
    const baseSha = git(root, ["rev-parse", "HEAD"]).trim();
    // Simulate a fetched base branch (what actions/checkout leaves behind)
    // without needing a real remote.
    git(root, ["update-ref", "refs/remotes/origin/main", baseSha]);

    // Change the owned file WITHOUT touching specs/engine-api.md.
    writeFile(root, "packages/foo/src/foo.ts", "export const x = 2;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "change foo without a spec diff"]);

    // 1. Direct runCheck() API call with an explicit baseRef — no env var touched.
    const report = runCheck(root, { ci: true, baseRef: "main" });
    assert.equal(process.env.GITHUB_BASE_REF, undefined, "runCheck({ baseRef }) must not touch GITHUB_BASE_REF");
    assert.ok(
      report.errors.some((e) => e.includes("Ownership drift") && e.includes("packages/foo/src/foo.ts")),
      `expected an "Ownership drift" error, got:\n${report.errors.join("\n")}`
    );

    // 2. End-to-end CLI-level assertion: the actual --simulate-pr flag parsing.
    const cli = spawnSync("node", [CHECK_DRIFT_PATH, "--simulate-pr", root], { encoding: "utf8" });
    assert.equal(process.env.GITHUB_BASE_REF, undefined, "--simulate-pr CLI run must not touch GITHUB_BASE_REF");
    assert.notEqual(cli.status, 0, `expected non-zero exit, got ${cli.status}\nstdout:\n${cli.stdout}\nstderr:\n${cli.stderr}`);
    assert.ok(
      `${cli.stdout}${cli.stderr}`.includes("Ownership drift"),
      `expected "Ownership drift" in CLI output, got:\nstdout:\n${cli.stdout}\nstderr:\n${cli.stderr}`
    );
  } finally {
    if (previousBaseRef === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = previousBaseRef;
  }
});

test("class (c): ownership drift check is skipped outside PR context (no GITHUB_BASE_REF)", () => {
  const root = makeFixture();
  writeFile(root, "specs/ownership.json", JSON.stringify({ "packages/foo/**": "specs/engine-api.md" }, null, 2));
  writeFile(root, "specs/engine-api.md", "- [RH-006] (active) Owns packages/foo.\n");
  writeFile(root, "packages/foo/src/foo.ts", "export const x = 1;\n");

  const previousBaseRef = process.env.GITHUB_BASE_REF;
  delete process.env.GITHUB_BASE_REF;
  try {
    // ci: true but no GITHUB_BASE_REF -> the ownership check itself no-ops.
    const report = runCheck(root, { ci: true });
    assert.ok(!report.errors.some((e) => e.includes("Ownership drift")));
    assert.match(report.ownershipSkippedReason ?? "", /no GITHUB_BASE_REF/);
  } finally {
    if (previousBaseRef !== undefined) process.env.GITHUB_BASE_REF = previousBaseRef;
  }
});

test("ownership drift does NOT fire on a plain runCheck(root) call (ci defaults to false)", () => {
  const root = makeFixture();
  writeFile(root, "specs/ownership.json", JSON.stringify({ "packages/foo/**": "specs/engine-api.md" }, null, 2));
  writeFile(root, "specs/engine-api.md", "- [RH-007] (active) Owns packages/foo.\n");
  writeFile(root, "packages/foo/src/foo.ts", "export const x = 1;\n");

  const report = runCheck(root);
  assert.equal(report.errors.length, 0);
});
