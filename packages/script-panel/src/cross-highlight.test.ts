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

describe("findHighlightForNode pointer-path fallback (specs/ux-usage-mapping.md UX-1108, for pointer/set|interpolate nodes that carry no sourceNodeIds identifier at all)", () => {
  const POINTER_FIXTURE_GRAPH: Graph = {
    types: [{ signature: "float3" }],
    declarations: [{ op: "event/onSelect" }, { op: "pointer/set" }],
    variables: [],
    nodes: [
      { declaration: 0, configuration: { nodeIndex: { value: [1] } }, flows: { out: { node: 1, socket: "in" } } },
      {
        declaration: 1,
        configuration: { pointer: { value: ["/nodes/3/translation"] }, type: { value: [0] } },
        values: { value: { type: 0, value: [0, 0, 0] } },
        flows: {}
      }
    ]
  };

  it("has no sourceNodeIds entry for the pointer/set node at all (confirms the gap the fallback exists for)", () => {
    const { module } = importGraph(POINTER_FIXTURE_GRAPH);
    expect(Object.values(module.meta.sourceNodeIds)).not.toContain(1);
  });

  it("resolves via the pointerPath fallback when sourceNodeIds has nothing, selecting just the bare path text", () => {
    const { module } = importGraph(POINTER_FIXTURE_GRAPH);
    const { code, names } = emitModule(module, { flavor: "ts" });
    expect(code).toContain('"/nodes/3/translation"');

    const match = findHighlightForNode(module, names, code, 1, { pointerPath: "/nodes/3/translation" });
    expect(match).not.toBeNull();
    expect(match!.identifier).toBe("/nodes/3/translation");
    expect(code.slice(match!.offset, match!.offset + match!.length)).toBe("/nodes/3/translation");
  });

  it("returns null when the pointer path never appears in the emitted code (e.g. a stale/mismatched reference)", () => {
    const { module } = importGraph(POINTER_FIXTURE_GRAPH);
    const { code, names } = emitModule(module, { flavor: "ts" });
    expect(findHighlightForNode(module, names, code, 1, { pointerPath: "/nodes/999/scale" })).toBeNull();
  });

  it("falls back to the first occurrence when no enclosingHandlerNodeIndex hint is given, even with multiple identical-path occurrences", () => {
    const graph: Graph = {
      types: [{ signature: "float3" }],
      declarations: [{ op: "event/onSelect" }, { op: "event/onHoverIn" }, { op: "pointer/set" }],
      variables: [],
      nodes: [
        { declaration: 0, configuration: { nodeIndex: { value: [5] } }, flows: { out: { node: 2, socket: "in" } } }, // 0: onSelect -> pointer/set A
        { declaration: 1, configuration: { nodeIndex: { value: [5] } }, flows: { out: { node: 3, socket: "in" } } }, // 1: onHoverIn -> pointer/set B
        {
          declaration: 2,
          configuration: { pointer: { value: ["/nodes/5/translation"] }, type: { value: [0] } },
          values: { value: { type: 0, value: [0, 0, 0] } },
          flows: {}
        }, // 2: pointer/set A
        {
          declaration: 2,
          configuration: { pointer: { value: ["/nodes/5/translation"] }, type: { value: [0] } },
          values: { value: { type: 0, value: [1, 1, 1] } },
          flows: {}
        } // 3: pointer/set B — same path, set from a DIFFERENT handler
      ]
    };
    const { module } = importGraph(graph);
    const { code, names } = emitModule(module, { flavor: "ts" });
    const needle = '"/nodes/5/translation"';
    const firstAt = code.indexOf(needle);
    const secondAt = code.indexOf(needle, firstAt + 1);
    expect(secondAt).toBeGreaterThan(firstAt); // fixture sanity: genuinely two occurrences

    const match = findHighlightForNode(module, names, code, 3, { pointerPath: "/nodes/5/translation" });
    expect(match!.offset).toBe(firstAt + 1); // no hint given -> first occurrence, even though node 3 is the SECOND writer
  });

  it("prefers the occurrence inside the hinted enclosing handler's own body when multiple identical-path occurrences exist", () => {
    const graph: Graph = {
      types: [{ signature: "float3" }],
      declarations: [{ op: "event/onSelect" }, { op: "event/onHoverIn" }, { op: "pointer/set" }],
      variables: [],
      nodes: [
        { declaration: 0, configuration: { nodeIndex: { value: [5] } }, flows: { out: { node: 2, socket: "in" } } }, // 0: onSelect -> pointer/set A
        { declaration: 1, configuration: { nodeIndex: { value: [5] } }, flows: { out: { node: 3, socket: "in" } } }, // 1: onHoverIn -> pointer/set B
        {
          declaration: 2,
          configuration: { pointer: { value: ["/nodes/5/translation"] }, type: { value: [0] } },
          values: { value: { type: 0, value: [0, 0, 0] } },
          flows: {}
        }, // 2: pointer/set A (under onSelect, node 0)
        {
          declaration: 2,
          configuration: { pointer: { value: ["/nodes/5/translation"] }, type: { value: [0] } },
          values: { value: { type: 0, value: [1, 1, 1] } },
          flows: {}
        } // 3: pointer/set B (under onHoverIn, node 1)
      ]
    };
    const { module } = importGraph(graph);
    const { code, names } = emitModule(module, { flavor: "ts" });
    const needle = '"/nodes/5/translation"';
    const firstAt = code.indexOf(needle);
    const secondAt = code.indexOf(needle, firstAt + 1);

    // Hinting the SECOND handler (onHoverIn, graph node 1 — pointer/set B's
    // own enclosing handler per findEnclosingHandlerRoot) should select the
    // SECOND occurrence, not the naive first-in-document one.
    const match = findHighlightForNode(module, names, code, 3, { pointerPath: "/nodes/5/translation", enclosingHandlerNodeIndex: 1 });
    expect(match!.offset).toBe(secondAt + 1);

    // And hinting the FIRST handler (onSelect, graph node 0) for the FIRST
    // writer resolves to the first occurrence, confirming this isn't just
    // "always picks the last one" by coincidence.
    const matchA = findHighlightForNode(module, names, code, 2, { pointerPath: "/nodes/5/translation", enclosingHandlerNodeIndex: 0 });
    expect(matchA!.offset).toBe(firstAt + 1);
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
