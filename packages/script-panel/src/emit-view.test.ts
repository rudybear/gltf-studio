import { describe, expect, it } from "vitest";
import type { Graph } from "@gltfi/ir";
import { buildEmitView, provenanceComment } from "./emit-view.js";

const FIXTURE_GRAPH: Graph = {
  types: [{ signature: "float" }],
  declarations: [{ op: "event/onStart" }, { op: "math/add" }],
  variables: [{ id: "counter", type: 0, value: [0] }],
  nodes: [{ declaration: 0 }, { declaration: 1, values: { a: { type: 0, value: [1] }, b: { type: 0, value: [2] } } }]
};

describe("buildEmitView (UX-700/UX-705)", () => {
  it("opens with a leading provenance comment naming the source graph (UX-705)", () => {
    const view = buildEmitView(FIXTURE_GRAPH, 0);
    expect(view.code.startsWith(provenanceComment(0))).toBe(true);
    expect(view.code).toContain("generated from graph 0");
  });

  it("contains the fixture's expected identifiers: a `V.` vars declaration and rt.onStart", () => {
    const view = buildEmitView(FIXTURE_GRAPH, 0);
    expect(view.code).toContain("const V = rt.vars(");
    expect(view.code).toContain("rt.onStart(");
    expect(view.names.variables).toContain("counter");
  });

  it("does not throw on a graph referencing an out-of-range declaration index (importGraph's own robustness, exercised through this wrapper)", () => {
    const badGraph: Graph = { types: [], declarations: [{ op: "event/onStart" }], nodes: [{ declaration: 5 }] };
    expect(() => buildEmitView(badGraph, 0)).not.toThrow();
  });
});
