export type { FrameScheduler } from "./scheduler.js";
export { createDefaultScheduler } from "./scheduler.js";
export type { PlayControllerDeps, PlayState } from "./play-controller.js";
export { createPlayController, FIXED_TICK_DT, PlayControllerImpl, buildVariablesRecord } from "./play-controller.js";
/** PC-009/specs/ux-debugger.md UX-1502: the debug compiled-play virtual filename scheme — packages/app's PlayOverlay.tsx (UX-1504) imports this rather than restating the literal string. */
export { debugVirtualSourceUrl } from "./debug-source.js";
