// Copies the repo root's committed sample asset (samples/r4-racer.glb --
// see samples/README.md for what it is and where it comes from) into this
// package's public/ dir so Vite serves it as a static asset at
// "/r4-racer.glb" -- same "generated into public/, gitignored, regenerated
// on every predev/prebuild" pattern as ./bundle-runtime-lib.mjs's
// gltfi-runtime-lib.mjs, and exactly the file Viewport.tsx's empty-state
// starter gallery (specs/ux-shell.md UX-120, supersedes UX-119) fetches for
// its R4 Racer card. Deliberately a plain file copy, not an import -- the
// sample must never be pulled into the main JS bundle.
//
// samples/playground.glb (UX-119's retired "Playground" card asset) is
// deliberately NOT copied here as of UX-120: it's no longer part of the
// shipped app at all, only a test-only fixture scripts/make-sample.mjs
// still regenerates and e2e/golden-path.spec.ts still loads directly off
// disk via the top bar's Import control (`topbar.import-input`).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = resolve(here, "../../../samples");
const outDir = resolve(here, "../public");
mkdirSync(outDir, { recursive: true });

for (const name of ["r4-racer.glb"]) {
  const src = resolve(samplesDir, name);
  const dest = resolve(outDir, name);
  copyFileSync(src, dest);
  console.log(`[copy-sample] copied ${src} -> ${dest}`);
}
