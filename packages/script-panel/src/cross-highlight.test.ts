import { describe, expect, it } from "vitest";
import { importGraph, type Graph } from "@gltfi/ir";
import { emitModule } from "@gltfi/emit-ts";
import { findHighlightForNode, offsetToLineColumn } from "./cross-highlight.js";

const FIXTURE_GRAPH: Graph = {
  types: [{ signature: "float" }],
  declarations: [{ op: "event/onStart" }, { op: "math/add" }],
  variables: [{ id: "counter", type: 0, value: [0] }],
  nodes: [{ declaration: 0 }, { declaration: 1, values: { a: { type: 0, value: [1] }, b: { type: 0, value: [2] } } }]
};

describe("findHighlightForNode (UX-712 best-effort cross-highlight)", () => {
  it("resolves a handler node to its rt.<kind>( call occurrence", () => {
    const { module } = importGraph(FIXTURE_GRAPH);
    const { code, names } = emitModule(module, { flavor: "ts" });
    expect(module.meta.sourceNodeIds["handler:0"]).toBe(0);

    const match = findHighlightForNode(module, names, code, 0);
    expect(match).not.toBeNull();
    expect(match!.identifier).toBe("rt.onStart");
    expect(code.slice(match!.offset, match!.offset + match!.length)).toBe("onStart");
  });

  it("returns null for a graph node the emitted module carries no origin record for (fully unreferenced node — UX-712's honest no-op)", () => {
    const { module } = importGraph(FIXTURE_GRAPH);
    const { code, names } = emitModule(module, { flavor: "ts" });
    // Node 1 (math/add) is unconnected — nothing reads its output and it
    // feeds no handler flow, so importGraph never records a sourceNodeIds
    // origin for it at all.
    expect(Object.values(module.meta.sourceNodeIds)).not.toContain(1);
    expect(findHighlightForNode(module, names, code, 1)).toBeNull();
  });

  it("returns null for a node index nothing maps to at all", () => {
    const { module } = importGraph(FIXTURE_GRAPH);
    const { code, names } = emitModule(module, { flavor: "ts" });
    expect(findHighlightForNode(module, names, code, 999)).toBeNull();
  });
});

describe("offsetToLineColumn", () => {
  it("converts a plain character offset to 1-based {lineNumber, column}", () => {
    const code = "line1\nline2\nline3";
    expect(offsetToLineColumn(code, 0)).toEqual({ lineNumber: 1, column: 1 });
    expect(offsetToLineColumn(code, 6)).toEqual({ lineNumber: 2, column: 1 });
    expect(offsetToLineColumn(code, 8)).toEqual({ lineNumber: 2, column: 3 });
  });
});
