// The environment-agnostic half of the debug compiled-play pipeline
// (docs/adr/0006-devtools-script-debugging.md): turns flavor-TS text (the
// EXACT text @gltf-studio/script-panel's Script tab shows, see
// engine-host.ts's buildDebugModule) into JS + a real inline source map via
// `esbuild-wasm`'s `transform()`. Deliberately factored out of
// `esbuild.worker.ts` (the browser Worker entry that actually calls this in
// production) so it can be exercised directly by a plain-Node unit test
// (esbuild-transform.test.ts) — `esbuild-wasm`'s Node entry point
// (`lib/main.js`, resolved via this package's plain `import * as esbuild
// from "esbuild-wasm"`, no bundler-specific `browser` field override) runs
// happily under Node with a bare `initialize({})` (it spawns its own child
// process internally); it's ONLY the browser entry that requires the
// `wasmURL`/`worker` options `esbuild.worker.ts` passes. Both entry points
// expose the identical `transform()` contract this file calls, which is
// what makes one shared function here meaningful rather than two
// independent re-implementations.
import * as esbuild from "esbuild-wasm";

export type EsbuildInitOptions = Parameters<typeof esbuild.initialize>[0];

let initPromise: Promise<void> | null = null;

/** Idempotent across repeated calls with the SAME options — esbuild-wasm itself throws if `initialize()` is ever called twice. */
function ensureInitialized(options: EsbuildInitOptions): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize(options);
  }
  return initPromise;
}

/**
 * Transforms flavor-TS source into JS with an INLINE source map (`sources:
 * [sourcefile]`, `sourcesContent: [code]` — esbuild's `transform()` always
 * embeds the exact input text it was given as `sourcesContent[0]`, which is
 * what makes specs/ux-debugger.md UX-1503's text-identity guarantee checkable
 * at all: decode the returned code's inline map and compare). Does NOT
 * append a `//# sourceURL=` comment — that is `engine-host.ts`'s concern
 * (it's a compiled-play-specific naming choice, not a property of "transform
 * TS to debuggable JS" in general).
 */
export async function transformTsToDebugJs(code: string, sourcefile: string, initOptions: EsbuildInitOptions = {}): Promise<string> {
  await ensureInitialized(initOptions);
  const result = await esbuild.transform(code, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcefile,
    sourcemap: "inline",
    sourcesContent: true
  });
  return result.code;
}
