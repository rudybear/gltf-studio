// D2 (specs/ux-debugger.md UX-1505 block): graph-node <-> Script-tab-line
// resolution coverage — the same shared machinery BehaviorGraphPanel.tsx's
// breakpoint badges (UX-1506) and "Break here" action (UX-1507) both build
// on. Graph fixtures below mirror packages/play/src/test-fixtures.ts's own
// handwritten-against-@gltfi/kernel's-registry convention (verified shapes,
// not invented ones) — a tiny `onTick` handler and a `pointer/set` node, the
// two cases `resolveBreakpointLine`'s two code paths (handler-kind
// `sourceNodeIds` lookup vs. the pointer-path fallback) each need.
import { describe, expect, it } from "vitest";
import type { Graph as IrGraph } from "@gltfi/ir";
import { buildBreakpointEmitView, computeBreakpointNodeIndices, resolveBreakpointLine } from "./script-breakpoints.js";

/** onTick -> variable/set(counter, 1). Node 0 is the handler; node 1 the (unresolvable, `temp`-free) variable/set write inside it. */
function onTickGraph(): IrGraph {
  return {
    types: [{ signature: "int" }],
    variables: [{ id: "counter", type: 0, value: [0] }],
    events: [],
    declarations: [{ op: "event/onTick" }, { op: "variable/set" }],
    nodes: [
      { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 1, socket: "in" } } },
      { declaration: 1, configuration: { variables: { value: [0] } }, values: { "0": { type: 0, value: [1] } }, flows: {} }
    ]
  } as unknown as IrGraph;
}

/** onStart -> pointer/set("/nodes/0/translation", ...). Node 1 is the pointer node — no `sourceNodeIds` entry of its own (cross-highlight.ts's documented gap), resolved only via the pointer-path text fallback. */
function pointerSetGraph(pointer = "/nodes/0/translation"): IrGraph {
  return {
    types: [{ signature: "float3" }],
    variables: [],
    events: [],
    declarations: [{ op: "event/onStart" }, { op: "pointer/set" }],
    nodes: [
      { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 1, socket: "in" } } },
      { declaration: 1, configuration: { pointer: { value: [pointer] }, type: { value: [0] } }, values: { value: { type: 0, value: [0, 0, 0] } }, flows: {} }
    ]
  } as unknown as IrGraph;
}

describe("resolveBreakpointLine (specs/ux-debugger.md UX-1505/UX-1507)", () => {
  it("resolves an onTick handler node to the line its `rt.onTick(` call occupies", () => {
    const graph = onTickGraph();
    const view = buildBreakpointEmitView(graph, 0);
    const line = resolveBreakpointLine(graph, view, 0);
    expect(line).not.toBeNull();
    expect(view.code.split("\n")[line! - 1]).toContain("rt.onTick(");
  });

  it("resolves a pointer/set node via the pointer-path text fallback (no sourceNodeIds entry exists for this kind)", () => {
    const graph = pointerSetGraph();
    const view = buildBreakpointEmitView(graph, 0);
    const line = resolveBreakpointLine(graph, view, 1);
    expect(line).not.toBeNull();
    expect(view.code.split("\n")[line! - 1]).toContain("/nodes/0/translation");
  });

  it("returns null for a node with no resolvable text occurrence (an out-of-range index)", () => {
    const graph = onTickGraph();
    const view = buildBreakpointEmitView(graph, 0);
    expect(resolveBreakpointLine(graph, view, 99)).toBeNull();
  });
});

describe("computeBreakpointNodeIndices (specs/ux-debugger.md UX-1506)", () => {
  it("returns the empty set when no breakpoint lines are given", () => {
    const graph = onTickGraph();
    const view = buildBreakpointEmitView(graph, 0);
    expect(computeBreakpointNodeIndices(graph, view, [])).toEqual(new Set());
  });

  it("maps a breakpoint line back to exactly the node(s) resolving to it", () => {
    const graph = onTickGraph();
    const view = buildBreakpointEmitView(graph, 0);
    const line = resolveBreakpointLine(graph, view, 0)!;
    expect(computeBreakpointNodeIndices(graph, view, [line])).toEqual(new Set([0]));
  });

  it("a line matching no node's resolved line produces no badges", () => {
    const graph = onTickGraph();
    const view = buildBreakpointEmitView(graph, 0);
    const totalLines = view.code.split("\n").length;
    expect(computeBreakpointNodeIndices(graph, view, [totalLines + 50])).toEqual(new Set());
  });
});
