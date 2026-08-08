#!/usr/bin/env node
// Regenerates vendor/gltfi-{kernel,ir,gltf,emit-ts,parse-ts,verify,runtime,
// runtime-lib}-0.0.1.tgz from the sibling gltf-interactivity monorepo, and
// vendor/gltfi-three-adapter-0.0.1.tgz from the sibling
// gltf-interactivity-three repo's packages/adapter — both assumed checked
// out next to this repo (the same convention gltf-interactivity-three and
// gltf-interactivity-vscode's own refresh-vendor.mjs scripts use). Vendoring
// instead of `npm install`ing published packages because none of these are
// published to npm yet — see docs/adr/0003-vendored-gltfi-tarballs.md.
//
// Usage: node scripts/refresh-vendor.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const monorepoRoot = resolve(repoRoot, "..", "gltf-interactivity");
const threeRepoRoot = resolve(repoRoot, "..", "gltf-interactivity-three");
const vendorDir = join(repoRoot, "vendor");

const GLTFI_PACKAGES = [
  "kernel",
  "ir",
  "gltf",
  "emit-ts",
  "parse-ts",
  "verify",
  "runtime",
  "runtime-lib"
];

function run(command, args, cwd) {
  console.log(`$ (${cwd}) ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`refresh-vendor: "${command} ${args.join(" ")}" failed in ${cwd}`);
    process.exit(result.status ?? 1);
  }
}

function distMissing(monorepo, pkgDirs) {
  return pkgDirs.some((dir) => !existsSync(join(monorepo, "packages", dir, "dist")));
}

function packOne(pkgDir, tarballPrefix, destDir) {
  if (!existsSync(pkgDir)) {
    console.error(`refresh-vendor: missing package directory ${pkgDir}`);
    process.exit(1);
  }
  // Clear any stale tarballs from a previous run so we don't accidentally
  // pick one up below.
  for (const entry of readdirSync(pkgDir)) {
    if (entry.startsWith(tarballPrefix) && entry.endsWith(".tgz")) {
      unlinkSync(join(pkgDir, entry));
    }
  }

  run("pnpm", ["pack"], pkgDir);

  const produced = readdirSync(pkgDir).find(
    (entry) => entry.startsWith(tarballPrefix) && entry.endsWith(".tgz")
  );
  if (!produced) {
    console.error(`refresh-vendor: "pnpm pack" in ${pkgDir} did not produce a ${tarballPrefix}*.tgz`);
    process.exit(1);
  }

  const dest = join(destDir, produced);
  copyFileSync(join(pkgDir, produced), dest);
  unlinkSync(join(pkgDir, produced));
  console.log(`refresh-vendor: wrote vendor/${produced}`);
}

if (!existsSync(monorepoRoot)) {
  console.error(`refresh-vendor: expected sibling monorepo at ${monorepoRoot} — not found.`);
  process.exit(1);
}
if (!existsSync(threeRepoRoot)) {
  console.error(`refresh-vendor: expected sibling repo at ${threeRepoRoot} — not found.`);
  process.exit(1);
}

mkdirSync(vendorDir, { recursive: true });

if (distMissing(monorepoRoot, GLTFI_PACKAGES)) {
  console.log(`refresh-vendor: building ${monorepoRoot} (dist missing for at least one package) ...`);
  run("pnpm", ["build"], monorepoRoot);
} else {
  console.log(`refresh-vendor: ${monorepoRoot} dist/ already present for all packages, skipping build.`);
}

for (const pkg of GLTFI_PACKAGES) {
  packOne(join(monorepoRoot, "packages", pkg), `gltfi-${pkg}-`, vendorDir);
}

const adapterDir = join(threeRepoRoot, "packages", "adapter");
if (!existsSync(join(adapterDir, "dist"))) {
  console.log(`refresh-vendor: building ${threeRepoRoot} (adapter dist missing) ...`);
  run("pnpm", ["build"], threeRepoRoot);
} else {
  console.log(`refresh-vendor: ${adapterDir} dist/ already present, skipping build.`);
}
packOne(adapterDir, "gltfi-three-adapter-", vendorDir);

console.log("refresh-vendor: done. Run `pnpm install` to pick up any version changes.");
