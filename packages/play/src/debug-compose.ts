// The shared tail of every debug pipeline this package builds: D1's
// interactivity compiled-play debug module (engine-host.ts's
// `buildDebugModule`) AND D3's audio-script "Debug audition" builder
// (packages/app's audio-debug-audition.ts) both end with the SAME three
// steps — inject any requested breakpoint lines (D2, debug-breakpoints.ts),
// transform via esbuild-wasm off-thread (debug-transform.ts), and append the
// stable virtual `//# sourceURL=` comment (debug-source.ts) a real DevTools
// session addresses the running script by. One implementation, not two
// independently-maintained copies of "how a debug module gets built" — the
// two call sites only ever differ in WHAT text/name they feed in, mirroring
// docs/adr/0006's own "text identity is a mechanism, not a promise" stance
// on `buildEmitView`.
import { transformForDebug } from "./debug-transform.js";
import { injectBreakpoints } from "./debug-breakpoints.js";
import { appendDebugSourceUrl } from "./debug-source.js";

export async function buildDebugModuleSource(tsText: string, sourceUrl: string, breakpointLines: readonly number[] = []): Promise<string> {
  const withBreakpoints = injectBreakpoints(tsText, breakpointLines);
  const jsCode = await transformForDebug(withBreakpoints, sourceUrl);
  return appendDebugSourceUrl(jsCode, sourceUrl);
}
