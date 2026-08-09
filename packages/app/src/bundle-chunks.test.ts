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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(APP_ROOT, "dist");
const TS_MORPH_MARKER = "getPreEmitDiagnostics";

function readMainEntryChunk(): string {
  const html = readFileSync(join(DIST_DIR, "index.html"), "utf8");
  const match = /<script[^>]*\ssrc="\/(assets\/[^"]+\.js)"/.exec(html);
  if (!match) throw new Error(`Could not find the main entry <script> tag in ${DIST_DIR}/index.html.`);
  return readFileSync(join(DIST_DIR, match[1]), "utf8");
}

function readParseWorkerChunk(): string {
  const assetsDir = join(DIST_DIR, "assets");
  const files = readdirSync(assetsDir).filter((f) => f.startsWith("parse.worker-") && f.endsWith(".js"));
  if (files.length === 0) {
    throw new Error(`No built chunk matching "parse.worker-*.js" in ${assetsDir} — expected Vite's static \`new Worker(new URL("./parse.worker.js", import.meta.url))\` detection (parse-client.ts) to emit one.`);
  }
  return files.map((f) => readFileSync(join(assetsDir, f), "utf8")).join("\n");
}

describe.skipIf(!existsSync(DIST_DIR))("built app bundle chunking (specs/ux-script.md UX-707/UX-709)", () => {
  it("keeps ts-morph (via @gltfi/parse-ts) OUT of the main app entry chunk", () => {
    expect(readMainEntryChunk()).not.toContain(TS_MORPH_MARKER);
  });

  it("confirms ts-morph really is bundled in the parse worker's own chunk (so the assertion above is meaningful, not just a marker that never appears anywhere)", () => {
    expect(readParseWorkerChunk()).toContain(TS_MORPH_MARKER);
  });
});
