// D3 (specs/ux-debugger.md UX-1508/UX-1509): "Debug audition" for the Audio
// Script tab. Audio scripts do NOT execute at play time — the audio graph
// this app actually plays is built straight from the document's JSON
// (`@gltf-studio/engine-api`'s `AudioGraphHost`, AudioGraphJS's `buildGraph`),
// never by running the authored `(a: AudioScript) => void` module function.
// D1/D2's whole compiled-play debug pipeline therefore has nothing to attach
// to on the audio side — there is no "play" of the script to debug.
//
// What DOES exist, investigated for this task: the vendored
// `@gltf-audiograph/runtime-lib` ships `createAudioScriptRecorder()` (its
// own `recorder.d.ts`), a REAL, executable `AudioScript` implementation —
// each `a.gain()`/`a.source()`/etc. call synchronously records itself and
// returns a real handle, and `.toGraph()` afterward reconstructs the
// `KHR_audio_graph` shape from what was recorded. This is precisely the
// "builder that runs the module function to construct a graph" the D3
// investigation was scoped to look for — nothing here is invented or faked:
// "Debug audition" executes the CURRENT Audio Script tab text, transformed
// through the exact same esbuild-wasm + breakpoint-injection pipeline D1/D2
// built (`@gltf-studio/play`'s `buildDebugModuleSource`, reused verbatim —
// not re-implemented), against this real recorder. A `debugger;` statement
// (D2's gutter breakpoints) or a real DevTools breakpoint set against the
// virtual `gltf-studio:///audio/graph{N}.ts` name genuinely pauses INSIDE
// the running module-function body, at real construction time — the same
// honest guarantee D1 established for the interactivity side, just for
// audio-graph CONSTRUCTION rather than a ticking play loop (audio graphs
// have no tick loop to pause mid-frame; there is only ever the one
// synchronous construction call, made explicitly by this function, never by
// any automatic "Play" action).
import { buildDebugModuleSource, audioDebugVirtualSourceUrl } from "@gltf-studio/play";
import { createAudioScriptRecorder, type AudioModule } from "@gltf-audiograph/runtime-lib";

export type AudioDebugAuditionResult = {
  graph: Record<string, unknown>;
  sources: Array<{ source: number; entry: Record<string, unknown> }>;
};

/**
 * Loads `code` (JS + inline source map, `//# sourceURL=` already appended by
 * `buildDebugModuleSource`) as a real ES module via a `blob:` URL + dynamic
 * `import()` — the same load mechanism `@gltf-studio/play`'s
 * `engine-host.ts` uses for the interactivity compiled/debug module, kept
 * local here rather than exported from that package: this is the only
 * caller, and the two loaders differ in one meaningful way (this one expects
 * a `(a: AudioScript) => void` default export, not an `EngineFactory`).
 */
async function loadAudioModule(code: string): Promise<AudioModule> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    // @vite-ignore: `blobUrl` is a runtime-computed blob: URL, never a static string a bundler could analyze/pre-bundle — same rationale as engine-host.ts's own `import(/* @vite-ignore */ blobUrl)`.
    const mod = (await import(/* @vite-ignore */ blobUrl)) as { default?: AudioModule };
    if (typeof mod.default !== "function") {
      throw new Error("Debug audition: audio script has no default-exported module function.");
    }
    return mod.default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Executes `tsText` (the Audio Script tab's current emitted/edited text) for
 * construction-time debugging: transform -> load -> run against a real
 * `AudioScript` recorder -> return the graph it built. Rejects if the text
 * fails to transform/load, or if running it throws (a script bug —
 * surfaced to the caller exactly like any other Debug audition failure, not
 * swallowed).
 */
export async function runAudioDebugAudition(
  tsText: string,
  graphIndex: number,
  breakpointLines: readonly number[] = []
): Promise<AudioDebugAuditionResult> {
  const sourceUrl = audioDebugVirtualSourceUrl(graphIndex);
  const jsCode = await buildDebugModuleSource(tsText, sourceUrl, breakpointLines);
  const moduleFn = await loadAudioModule(jsCode);
  const { script, toGraph } = createAudioScriptRecorder();
  moduleFn(script);
  return toGraph();
}
