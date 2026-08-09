// Copies the repo root's committed sample assets (samples/playground.glb,
// samples/r4-racer.glb -- see samples/README.md for what each is and where
// it comes from) into this package's public/ dir so Vite serves them as
// static assets at "/playground.glb" / "/r4-racer.glb" -- same
// "generated into public/, gitignored, regenerated on every predev/prebuild"
// pattern as ./bundle-runtime-lib.mjs's gltfi-runtime-lib.mjs, and exactly
// the files Viewport.tsx's empty-state starter gallery (specs/ux-shell.md
// UX-119) fetches. Deliberately a plain file copy, not an import -- neither
// sample must ever be pulled into the main JS bundle.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = resolve(here, "../../../samples");
const outDir = resolve(here, "../public");
mkdirSync(outDir, { recursive: true });

for (const name of ["playground.glb", "r4-racer.glb"]) {
  const src = resolve(samplesDir, name);
  const dest = resolve(outDir, name);
  copyFileSync(src, dest);
  console.log(`[copy-sample] copied ${src} -> ${dest}`);
}
