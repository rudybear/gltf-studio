// D2 (docs/adr/0006 follow-on, specs/ux-debugger.md UX-1505 block): the
// graph-node <-> Script-tab-line resolution shared by BehaviorGraphPanel.tsx's
// graph-canvas breakpoint badges (UX-1506) and its "Break here" node-details
// action (UX-1507) — both need the SAME answer a breakpoint set directly via
// the Script tab's own gutter would occupy for that node, so there is
// exactly one place this resolution happens, reusing
// `@gltf-studio/script-panel`'s existing UX-712/UX-1108 cross-highlight
// machinery (the identical node -> code-region lookup the Script tab's own
// jump-on-select already performs) rather than a second, drifting
// implementation.
//
// Both `@gltf-studio/script-panel` subpaths used here (`./emit-view`,
// `./cross-highlight`) are the same "narrow subpath, not the whole barrel"
// precedent `docs/adr/0006` established for `packages/play`'s identical
// dependency edge: BehaviorGraphPanel.tsx is EAGERLY mounted (BottomDock.tsx
// never gates the Behavior graph tab behind a "first opened" flag, unlike
// the Script tab's own `React.lazy`), so pulling in the full script-panel
// package (monaco-editor, the whole `ScriptPanel` component tree) here would
// put real weight in the app's main bundle for a mode most sessions never
// open.
import type { Graph as IrGraph } from "@gltfi/ir";
import { buildEmitView, type EmitView } from "@gltf-studio/script-panel/emit-view";
import { findHighlightForNode, offsetToLineColumn } from "@gltf-studio/script-panel/cross-highlight";
import { findEnclosingHandlerRoot, type UsageInteractivityGraph } from "@gltf-studio/usage-index";

/** Mirrors `@gltf-studio/graph-canvas`'s identical set (`map-graph.ts`'s own `POINTER_OPS`) — not imported, per that file's own "this package has no dependency on that one" non-import rationale, which applies here too (this module has no reason to depend on graph-canvas). */
const POINTER_OPS = new Set(["pointer/get", "pointer/set", "pointer/interpolate"]);

/** `null` for a non-pointer node, or a pointer node with no `configuration.pointer` set yet (nothing for `findHighlightForNode`'s fallback search to look for). */
function pointerPathOf(graph: IrGraph, nodeIndex: number): string | null {
  const node = graph.nodes[nodeIndex];
  const decl = node ? graph.declarations[node.declaration] : undefined;
  if (!node || !decl || !POINTER_OPS.has(decl.op)) return null;
  const value = node.configuration?.pointer?.value?.[0];
  return typeof value === "string" ? value : null;
}

/** Builds the graph's current Emit view once — callers memoize this against `[rawGraph, graphIndex]` and reuse it for every node's line lookup below, rather than re-running `importGraph`+`emitModule` (buildEmitView's own cost) once per node. */
export function buildBreakpointEmitView(graph: IrGraph, graphIndex: number): EmitView {
  return buildEmitView(graph, graphIndex);
}

/**
 * The 1-based Script-tab line `nodeIndex` maps to, or `null` when this node
 * has no resolvable text occurrence at all — UX-712's documented fidelity
 * gap (a `temp`-kind construct, or an unresolved/templated pointer path) has
 * no line to break on; this is the SAME `null` a Script-tab jump for that
 * node would also produce (`cross-highlight.ts`'s own header comment).
 */
export function resolveBreakpointLine(graph: IrGraph, view: EmitView, nodeIndex: number): number | null {
  const pointerPath = pointerPathOf(graph, nodeIndex);
  const options = pointerPath
    ? { pointerPath, enclosingHandlerNodeIndex: findEnclosingHandlerRoot(graph as unknown as UsageInteractivityGraph, nodeIndex) }
    : undefined;
  const match = findHighlightForNode(view.module, view.names, view.code, nodeIndex, options);
  return match ? offsetToLineColumn(view.code, match.offset).lineNumber : null;
}

/** Every `graph.nodes[]` index whose resolved line (`resolveBreakpointLine`) is currently a member of `breakpointLines` — the graph-canvas badge set (UX-1506). */
export function computeBreakpointNodeIndices(graph: IrGraph, view: EmitView, breakpointLines: readonly number[]): Set<number> {
  const result = new Set<number>();
  if (breakpointLines.length === 0) return result;
  const lines = new Set(breakpointLines);
  for (let i = 0; i < graph.nodes.length; i++) {
    const line = resolveBreakpointLine(graph, view, i);
    if (line !== null && lines.has(line)) result.add(i);
  }
  return result;
}
