#!/usr/bin/env node
// Regenerates vendor/gltfi-{kernel,ir,gltf,emit-ts,parse-ts,verify,runtime,
// runtime-lib}-0.0.1.tgz from the sibling gltf-interactivity monorepo,
// vendor/gltfi-three-adapter-0.0.1.tgz from the sibling
// gltf-interactivity-three repo's packages/adapter, and (M7)
// vendor/audio-graph-js-0.1.0.tgz from the sibling glTF-audio/AudioGraphJS
// repo — all assumed checked out next to this repo (the same convention
// gltf-interactivity-three and gltf-interactivity-vscode's own
// refresh-vendor.mjs scripts use). Vendoring instead of `npm install`ing
// published packages because none of these are published to npm yet — see
// docs/adr/0003-vendored-gltfi-tarballs.md.
//
// Usage: node scripts/refresh-vendor.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const monorepoRoot = resolve(repoRoot, "..", "gltf-interactivity");
const threeRepoRoot = resolve(repoRoot, "..", "gltf-interactivity-three");
const audioGraphJsRoot = resolve(repoRoot, "..", "glTF-audio", "AudioGraphJS");
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

// audio-graph-js: unlike the @gltfi/* packages and the three-adapter, its
// own package.json declares no "files"/"main"/"exports" — `dist/` is even
// .gitignore'd there — so a plain `npm pack` in that checkout would ship an
// empty-of-runtime-code tarball (everything under .gitignore excluded, no
// entry point declared). No src/ changes are needed to build or use it, but
// packing it cleanly does need those three fields; rather than asking that
// sibling repo to carry a permanent packaging change for our sake, this
// script writes a temporary overlay onto ITS package.json, packs, then
// restores the original file byte-for-byte.
if (!existsSync(audioGraphJsRoot)) {
  console.error(`refresh-vendor: expected sibling repo at ${audioGraphJsRoot} — not found.`);
  process.exit(1);
}
if (!existsSync(join(audioGraphJsRoot, "dist"))) {
  console.log(`refresh-vendor: building ${audioGraphJsRoot} (dist missing) ...`);
  run("npm", ["run", "build"], audioGraphJsRoot);
} else {
  console.log(`refresh-vendor: ${audioGraphJsRoot} dist/ already present, skipping build.`);
}
packAudioGraphJs(audioGraphJsRoot, vendorDir);

console.log("refresh-vendor: done. Run `pnpm install` to pick up any version changes.");

function packAudioGraphJs(pkgDir, destDir) {
  const packageJsonPath = join(pkgDir, "package.json");
  const original = readFileSync(packageJsonPath, "utf8");
  const patched = JSON.parse(original);
  delete patched.private;
  patched.main = "./dist/index.js";
  patched.types = "./dist/index.d.ts";
  patched.exports = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
  patched.files = ["dist", "README.md"];
  // Unused by src/ (only tests/examples touch it) — keep it out of
  // consumers' resolved dependency tree, matching the vendored tarball
  // already committed at vendor/audio-graph-js-0.1.0.tgz.
  if (patched.dependencies?.["standardized-audio-context"]) {
    patched.devDependencies ??= {};
    patched.devDependencies["standardized-audio-context"] = patched.dependencies["standardized-audio-context"];
    delete patched.dependencies["standardized-audio-context"];
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(patched, null, 2)}\n`);
  try {
    for (const entry of readdirSync(pkgDir)) {
      if (entry.startsWith("audio-graph-js-") && entry.endsWith(".tgz")) {
        unlinkSync(join(pkgDir, entry));
      }
    }
    run("npm", ["pack", "--pack-destination", pkgDir], pkgDir);
    const produced = readdirSync(pkgDir).find((entry) => entry.startsWith("audio-graph-js-") && entry.endsWith(".tgz"));
    if (!produced) {
      console.error(`refresh-vendor: "npm pack" in ${pkgDir} did not produce an audio-graph-js-*.tgz`);
      process.exit(1);
    }
    copyFileSync(join(pkgDir, produced), join(destDir, produced));
    unlinkSync(join(pkgDir, produced));
    console.log(`refresh-vendor: wrote vendor/${produced}`);
  } finally {
    writeFileSync(packageJsonPath, original);
  }
}
