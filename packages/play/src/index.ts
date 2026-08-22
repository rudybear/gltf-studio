export type { FrameScheduler } from "./scheduler.js";
export { createDefaultScheduler } from "./scheduler.js";
export type { PlayControllerDeps, PlayState } from "./play-controller.js";
export { createPlayController, FIXED_TICK_DT, PlayControllerImpl, buildVariablesRecord } from "./play-controller.js";
/** PC-009/specs/ux-debugger.md UX-1502: the debug compiled-play virtual filename scheme — packages/app's PlayOverlay.tsx (UX-1504) imports this rather than restating the literal string. */
export { debugVirtualSourceUrl, audioDebugVirtualSourceUrl } from "./debug-source.js";
/** D2/specs/ux-debugger.md UX-1505: the breakpoint-injection primitive — exported so a unit test (and, in principle, another debug pipeline) can exercise it directly rather than only through the full `buildDebugModule` composition. */
export { injectBreakpoints } from "./debug-breakpoints.js";
/** D3/specs/ux-debugger.md UX-1509: the shared debug-module-build tail (inject breakpoints -> esbuild-wasm transform -> stable `//# sourceURL=`) — reused by packages/app's audio-script "Debug audition" builder so the audio and interactivity debug pipelines can never drift on HOW a debug module is built. */
export { buildDebugModuleSource } from "./debug-compose.js";
/** PC-010/specs/ux-debugger.md UX-1505: the graph index a debug-play session's breakpoints are always scoped to (`@gltf-studio/play` only ever resolves `graphs[0]`) — packages/app's `app-store.ts` imports this rather than restating the literal `0`. */
export { PLAY_GRAPH_INDEX } from "./engine-host.js";
