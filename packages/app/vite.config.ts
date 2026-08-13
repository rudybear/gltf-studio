import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sourcemaps from "rollup-plugin-sourcemaps2";

// BASE_PATH: configurable Vite `base`. The editor always lives one level
// below whatever site root it's served from — `/app/` locally (dev server
// and `vite preview`, matching this repo's own e2e config) and
// `/<repo>/app/` once deployed as a GitHub Pages PROJECT site, where a
// hand-written landing page (see `/site/`) occupies the actual root and
// the deploy workflow (`.github/workflows/deploy.yml`) sets BASE_PATH to
// the deeper path at build time — no code change needed for that move.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/app/",
  plugins: [react()],
  // Ship production source maps (external .map files, default Vite mode —
  // NOT "inline", which would bloat the JS itself): external-report DX
  // issue — the deployed app's minified, one-lined JS made devtools
  // stepping unreadable. Applies to the main app bundle AND worker chunks
  // (packages/script-panel's parse.worker.ts, graph-canvas's
  // layout.worker.ts, monaco-setup.ts's `?worker` editor/ts workers) —
  // Vite's `build.sourcemap` setting covers every emitted chunk, workers
  // included, not just the entry bundle. The compiled-engine blob path
  // (@gltfi/runtime-lib, served as a static asset) is bundled separately by
  // scripts/bundle-runtime-lib.mjs, which already passes `sourcemap: true`
  // to esbuild.
  //
  // rollup-plugin-sourcemaps2: this app imports OTHER workspace packages
  // (@gltf-studio/editor-core, graph-canvas, storage, ...) as their already
  // `tsc -b`-compiled `dist/*.js` + `dist/*.js.map` (composite project
  // references, see root tsconfig.json) — not their `src/*.ts` directly.
  // Without this plugin, Rollup bundles those pre-built `dist/*.js` files
  // as opaque JS with no knowledge of their own adjacent `.js.map`, so the
  // app bundle's OWN final source map would point back only as far as the
  // compiled `dist/*.js`, not the original `.ts` — defeating the point for
  // every workspace package except this one. This plugin reads each
  // pre-built file's existing `//# sourceMappingURL=` comment and its
  // referenced `.map` (which `tsconfig.base.json`'s `sourceMap: true`
  // already generates for every package) and chains it into the bundle's
  // map, so devtools resolves all the way back to real `.ts` sources.
  build: {
    sourcemap: true,
    rollupOptions: {
      plugins: [sourcemaps()]
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
