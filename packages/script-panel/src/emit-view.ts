// Builds the Script tab's Emit view (specs/ux-script.md UX-700/UX-705):
// `extensions.KHR_interactivity.graphs[graphIndex]` -> `@gltfi/ir`'s
// `importGraph` -> `@gltfi/emit-ts`'s `emitModule` -> real GIscript source
// text, with a leading provenance comment. This is the ONE place that knows
// how to go from a raw graph to displayable code — used both for the
// default read-only view and to (re)seed the editable buffer when a caller
// enters edit mode or discards unapplied edits by leaving it.
//
// Also reachable via this package's own `./emit-view` subpath export
// (package.json) — `@gltf-studio/play`'s debug compiled-play pipeline
// (docs/adr/0006-devtools-script-debugging.md, specs/ux-debugger.md UX-1503)
// imports `buildEmitView` from there directly rather than the aggregated
// `.` entry, so it never pulls in `monaco-editor`/React just to reach this
// one lightweight function — same "narrow subpath, not the whole barrel"
// precedent as `@gltfi/parse-ts`'s own `./runtime-lib-dts` export. That
// caller's text-identity guarantee (the debug session shows EXACTLY what
// the Script tab shows) depends on this staying the one and only place that
// turns a graph into displayable code — do not add a second one.
import { importGraph, type Diagnostic, type Graph, type IRModule } from "@gltfi/ir";
import { emitModule, type EmitNames } from "@gltfi/emit-ts";

export type EmitView = {
  code: string;
  names: EmitNames;
  module: IRModule;
  /** Diagnostics from `importGraph` itself (a malformed graph) — distinct from parse-side diagnostics (UX-709), which only apply to hand-edited code. */
  diagnostics: Diagnostic[];
};

/**
 * UX-705: "the emitted code opens with a leading comment naming which graph
 * it was generated from". `Graph` (the KHR_interactivity JSON shape) carries
 * no name field of its own (unlike the mockup's illustrative "Prop_01"/
 * "Default" example, which named a node and a hypothetical graph label) —
 * this repo's asset model has no per-graph name to report honestly, so the
 * comment identifies the graph by its index instead.
 */
export function provenanceComment(graphIndex: number): string {
  return `// Behavior script — generated from graph ${graphIndex}\n`;
}

export function buildEmitView(graph: Graph, graphIndex: number): EmitView {
  const { module, diagnostics } = importGraph(graph);
  const { code, names } = emitModule(module, { flavor: "ts" });
  return { code: provenanceComment(graphIndex) + code, names, module, diagnostics };
}

/**
 * Re-derives just the `names` (for UX-712 cross-highlight) for a module that
 * came from a hand-edited buffer via `parseModule` rather than from
 * `importGraph` — the buffer's own text is what's displayed (not this
 * function's `code`, which is discarded), but the identifiers `emitModule`
 * would produce for that module are exactly what a faithful round trip
 * (parse -> export -> reimport -> emit) is expected to already match in the
 * user's own buffer, per this pipeline's own byte-preserving-round-trip
 * guarantee.
 */
export function namesForModule(module: IRModule): EmitNames {
  return emitModule(module, { flavor: "ts" }).names;
}
