// docs/adr/0006-devtools-script-debugging.md / specs/ux-debugger.md UX-1502:
// the ONE place the debug compiled-play virtual filename scheme is spelled
// out. `engine-host.ts` (the compiled debug module's own `//# sourceURL=`
// AND its source map's `sources[0]`, per PC-009) and `packages/app`'s
// `PlayOverlay.tsx` (UX-1504's play-overlay hint copy) both import this
// rather than restating the literal string, so the two can never drift out
// of sync with each other.
//
// `PlayController`/`createEngineHost` only ever resolve `graphs[0]`
// (engine-host.ts's `resolveGraphOrThrow`), so `graphIndex` is always `0`
// today — parameterized anyway for whenever a document-level "which graph
// plays" choice exists, per specs/ux-debugger.md UX-1502's own note.
export function debugVirtualSourceUrl(graphIndex: number): string {
  return `gltf-studio:///behavior/graph${graphIndex}.ts`;
}

/**
 * D3 (specs/ux-debugger.md UX-1509): the audio-script "Debug audition"
 * pipeline's own virtual name, sibling to `debugVirtualSourceUrl` above —
 * same stable-name/DevTools-grouping role, under `/audio/` rather than
 * `/behavior/` so the two never collide in DevTools' Sources tree for a
 * document that has both an interactivity graph and an audio graph open for
 * debugging.
 */
export function audioDebugVirtualSourceUrl(graphIndex: number): string {
  return `gltf-studio:///audio/graph${graphIndex}.ts`;
}

/**
 * The pure, Worker-free half of `engine-host.ts`'s `buildDebugModule`
 * (factored out purely for Node-unit-testability — compiled-debug.test.ts
 * exercises this directly, since `buildDebugModule` itself needs a real
 * browser `Worker`, see that test file's own header comment): appends the
 * `//# sourceURL=` comment DevTools/CDP read as the running compiled
 * script's own name — deliberately the SAME literal string as the source
 * map's own `sources[0]` entry (`sourceUrl`), per docs/adr/0006's "one name,
 * two roles" design.
 */
export function appendDebugSourceUrl(jsCode: string, sourceUrl: string): string {
  return `${jsCode}\n//# sourceURL=${sourceUrl}\n`;
}
