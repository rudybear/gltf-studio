#!/usr/bin/env node
// Wires this repo's git hooksPath to .githooks/ (see .githooks/pre-push),
// so the fast local CI-parity gate (`pnpm check:fast`) runs automatically
// before every push, with no Husky dependency.
//
// Run automatically via the root package.json's "postinstall" script.
// Must be safe to run in ANY environment — including one without git, or
// where this repo is installed as a plain dependency rather than cloned —
// so failures here are swallowed rather than thrown; this must never break
// `pnpm install`.
import { spawnSync } from "node:child_process";

function isGitRepo() {
  const result = spawnSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" });
  return result.status === 0;
}

function setHooksPath() {
  const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { encoding: "utf8" });
  return result.status === 0;
}

try {
  if (!isGitRepo()) {
    console.log("setup-hooks: not a git repository — skipping git hooks setup.");
  } else if (setHooksPath()) {
    console.log("setup-hooks: git config core.hooksPath .githooks (pre-push checks armed).");
  } else {
    console.log("setup-hooks: could not set core.hooksPath — skipping (this is non-fatal).");
  }
} catch (err) {
  console.log(`setup-hooks: skipping git hooks setup (${err && err.message ? err.message : err}).`);
}
