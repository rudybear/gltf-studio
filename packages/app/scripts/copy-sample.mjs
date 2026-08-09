// Copies samples/playground.glb (generated + committed by the repo root's
// `pnpm sample` / scripts/make-sample.mjs) into this package's public/ dir
// so Vite serves it as a static asset at "/playground.glb" -- same
// "generated into public/, gitignored, regenerated on every predev/prebuild"
// pattern as ./bundle-runtime-lib.mjs's gltfi-runtime-lib.mjs, and the exact
// file Viewport.tsx's "Load sample scene" empty-state button (specs/
// ux-shell.md UX-114) fetches. Deliberately a plain file copy, not an import
// -- the sample must never be pulled into the main JS bundle.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../samples/playground.glb");
const outDir = resolve(here, "../public");
const dest = resolve(outDir, "playground.glb");

mkdirSync(outDir, { recursive: true });
copyFileSync(src, dest);

console.log(`[copy-sample] copied ${src} -> ${dest}`);
