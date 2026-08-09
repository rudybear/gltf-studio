// Bundles @gltfi/runtime-lib (+ its @gltfi/kernel dependency) into one
// self-contained, dependency-free ESM file that this app serves as a static
// asset. This is the target of the browser import map entry
// `"@gltfi/runtime-lib": "/gltfi-runtime-lib.mjs"` declared in index.html:
// packages/play's compiled-engine path (engine-host.ts) transpiles a
// KHR_interactivity graph to a JS module string, loads it from a `blob:`
// module URL via dynamic import(), and that module's own
// `import { createEngine, m } from "@gltfi/runtime-lib";` statement needs
// somewhere to resolve to. Browsers resolve a bare specifier inside ANY
// module script — including one loaded from a `blob:` URL — against the
// *hosting document's* own import map, never against the blob's own origin.
// So the fix lives here, at the document level, not in packages/play: one
// import map entry pointing at a real, self-contained file is all that's
// needed, and it must be dependency-free because a bare
// `import ... from "@gltfi/kernel"` inside that file would hit the exact
// same unresolvable-bare-specifier problem all over again.
//
// @gltfi/runtime-lib is a vendored tarball dependency in this repo (see
// pnpm-workspace.yaml's overrides), not a workspace package with a fixed
// relative dist path, so its real installed location is resolved through
// Node's own module resolution rather than a hardcoded path.
//
// Runs as `predev`/`prebuild` (see package.json) so both `vite` (dev server)
// and `vite build` + `vite preview` always see a fresh bundle: dev serves
// everything under public/ verbatim at the site root, and build copies
// public/ into dist/ verbatim — same path, `/gltfi-runtime-lib.mjs`, either
// way, so no dev-vs-preview divergence.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const entry = require.resolve("@gltfi/runtime-lib");
const outfile = resolve(here, "../public/gltfi-runtime-lib.mjs");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // @gltfi/runtime-lib bare-imports @gltfi/kernel (dist/engine.js,
  // dist/pointer.js, dist/math.js) — nothing here should be left external,
  // or the emitted bundle would just trade one unresolvable bare specifier
  // for another. Being explicit costs nothing and guards against a future
  // dependency silently trying to bundle in something browser-unsafe.
  external: [],
  sourcemap: true,
  logLevel: "info"
});

console.log(`[bundle-runtime-lib] wrote ${outfile}`);
