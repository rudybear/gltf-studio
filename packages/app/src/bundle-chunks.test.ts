// specs/ux-script.md's lazy-loading strategy (UX-707/UX-709): ts-morph (via
// @gltfi/parse-ts, packages/script-panel/src/parse.worker.ts) is a
// multi-hundred-KB parser/type-checker with no business in the app's main
// bundle — it must land ONLY in the parse Worker's own bundled chunk, never
// the entry chunk the browser loads on first paint. This is a bundle-shape
// assertion against the BUILT app (`pnpm build`'s `packages/app/dist/`),
// not a guess based on how the source is structured — code-splitting is a
// bundler behavior, not a source-level guarantee.
//
// Marker choice: a distinctive, minification-survivING string. Local
// variable/function/class names get renamed by production minification,
// but PROPERTY-ACCESS names (`sf.getPreEmitDiagnostics()`, called by
// @gltfi/parse-ts's own `parseModule` against a ts-morph `SourceFile`) are
// not safely renameable without full type information, so this exact
// method name survives as a literal string in the minified output even
// though everything around it doesn't. (Monaco's own bundled TypeScript
// worker also calls a same-named real TS API, so the marker is expected —
// and asserted below — to appear in Monaco's `ts.worker` chunk too; that's
// a different, unrelated worker, not evidence against this file's claim
// about the APP's main entry chunk.)
//
// specs/ux-audio-script.md UX-1400: @gltf-studio/audio-script-panel's own
// parse.worker.ts (@gltf-audiograph/parse-ts, also ts-morph-backed) mirrors
// this SAME rule. Both packages' source files happen to be named
// `parse.worker.ts`, so Vite's build emits two chunks both matching
// `parse.worker-*.js` (confirmed via a real `pnpm build` — the audio one is
// NOT a guess) — `readParseWorkerChunk()` below already joins every such
// chunk before searching, so the two existing assertions cover both workers
// as-is; `readParseWorkerChunks()` (plural) additionally lets this file
// assert there really are two distinct chunks, not just one lucky match.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(APP_ROOT, "dist");
const TS_MORPH_MARKER = "getPreEmitDiagnostics";
// docs/adr/0006-devtools-script-debugging.md / specs/ux-debugger.md UX-1501:
// `esbuild-wasm`'s own literal error-message text (from its `initialize()`
// double-call guard) — survives minification the same way TS_MORPH_MARKER
// does (a string literal, not a renameable identifier), and confirmed
// against a real `pnpm build` to appear in exactly `esbuild.worker-*.js`,
// nowhere else (this file's own "confirms the marker really is bundled
// there" test below is the same double-check TS_MORPH_MARKER already gets).
const ESBUILD_WASM_MARKER = 'Cannot call "initialize" more than once';

function readMainEntryChunk(): string {
  const html = readFileSync(join(DIST_DIR, "index.html"), "utf8");
  // The emitted `src` is absolute but prefixed with whatever `base` this
  // build used (vite.config.ts's default is now "/app/" rather than "/" —
  // see that file's own comment on the landing-page URL restructure), so
  // this only anchors on the trailing `assets/...` shape, not a specific
  // leading path.
  const match = /<script[^>]*\ssrc="\/(?:[^"]*\/)?(assets\/[^"]+\.js)"/.exec(html);
  if (!match) throw new Error(`Could not find the main entry <script> tag in ${DIST_DIR}/index.html.`);
  return readFileSync(join(DIST_DIR, match[1]), "utf8");
}

function parseWorkerChunkFiles(): string[] {
  const assetsDir = join(DIST_DIR, "assets");
  return readdirSync(assetsDir).filter((f) => f.startsWith("parse.worker-") && f.endsWith(".js"));
}

function readParseWorkerChunk(): string {
  const assetsDir = join(DIST_DIR, "assets");
  const files = parseWorkerChunkFiles();
  if (files.length === 0) {
    throw new Error(`No built chunk matching "parse.worker-*.js" in ${assetsDir} — expected Vite's static \`new Worker(new URL("./parse.worker.js", import.meta.url))\` detection (parse-client.ts / @gltf-studio/audio-script-panel's own parse-client.ts) to emit one.`);
  }
  return files.map((f) => readFileSync(join(assetsDir, f), "utf8")).join("\n");
}

function esbuildWorkerChunkFiles(): string[] {
  const assetsDir = join(DIST_DIR, "assets");
  return readdirSync(assetsDir).filter((f) => f.startsWith("esbuild.worker-") && f.endsWith(".js"));
}

function readEsbuildWorkerChunk(): string {
  const assetsDir = join(DIST_DIR, "assets");
  const files = esbuildWorkerChunkFiles();
  if (files.length === 0) {
    throw new Error(`No built chunk matching "esbuild.worker-*.js" in ${assetsDir} — expected Vite's static \`new Worker(new URL("./esbuild.worker.js", import.meta.url))\` detection (@gltf-studio/play's debug-transform.ts) to emit one.`);
  }
  return files.map((f) => readFileSync(join(assetsDir, f), "utf8")).join("\n");
}

describe.skipIf(!existsSync(DIST_DIR))("built app bundle chunking (specs/ux-script.md UX-707/UX-709; specs/ux-audio-script.md UX-1400)", () => {
  it("keeps ts-morph (via @gltfi/parse-ts AND @gltf-audiograph/parse-ts) OUT of the main app entry chunk", () => {
    expect(readMainEntryChunk()).not.toContain(TS_MORPH_MARKER);
  });

  it("confirms ts-morph really is bundled in the parse worker chunk(s) (so the assertion above is meaningful, not just a marker that never appears anywhere)", () => {
    expect(readParseWorkerChunk()).toContain(TS_MORPH_MARKER);
  });

  it("emits TWO distinct parse-worker chunks — one for the interactivity Script tab, one for the Audio Script tab (each package's own parse.worker.ts, not a single shared worker)", () => {
    expect(parseWorkerChunkFiles().length).toBe(2);
  });
});

describe.skipIf(!existsSync(DIST_DIR))("built app bundle chunking (docs/adr/0006-devtools-script-debugging.md, specs/ux-debugger.md UX-1501)", () => {
  it("keeps esbuild-wasm OUT of the main app entry chunk", () => {
    expect(readMainEntryChunk()).not.toContain(ESBUILD_WASM_MARKER);
  });

  it("confirms esbuild-wasm really is bundled in its own worker chunk (so the assertion above is meaningful, not just a marker that never appears anywhere)", () => {
    expect(readEsbuildWorkerChunk()).toContain(ESBUILD_WASM_MARKER);
  });

  it("ships the esbuild-wasm .wasm binary as its own asset, not inlined as a data: URI into any JS chunk (Vite's ?url import — see esbuild.worker.ts)", () => {
    const assetsDir = join(DIST_DIR, "assets");
    const wasmFiles = readdirSync(assetsDir).filter((f) => f.startsWith("esbuild-") && f.endsWith(".wasm"));
    expect(wasmFiles.length).toBe(1);
    expect(readEsbuildWorkerChunk()).not.toContain("data:application/wasm");
  });
});
