// Main-thread ELK layout fallback. Normally ALL layout work happens off the
// UI thread in layout.worker.ts (see its header comment for the message
// contract and why elkjs's solver lives only there). This module is the
// graceful-degradation path: if layout-engine.ts can't get the worker
// running at all, or it throws at runtime, we run the exact same elkjs
// solver synchronously on the main thread instead of leaving the graph
// unrendered.
//
// Dynamically imported by layout-engine.ts ONLY on that failure path (kept
// out of a static import here on purpose), so the common case — the worker
// path working — never pays for bundling elkjs's solver into the main
// bundle on top of the worker chunk already having it.

import ElkConstructor from "elkjs/lib/elk.bundled.js";
import { extractPositions, type ElkGraph, type LayoutPositions } from "./elk-layout.js";

let elk: InstanceType<typeof ElkConstructor> | null = null;

/** Runs elkjs's `layout()` synchronously in this JS context (main thread) and returns extracted positions. */
export async function layoutOnMainThread(elkGraph: ElkGraph): Promise<LayoutPositions> {
  elk ??= new ElkConstructor();
  const result = await elk.layout(elkGraph);
  return extractPositions(result);
}
