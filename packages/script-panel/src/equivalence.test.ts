import { describe, expect, it } from "vitest";
import { importGraph, type Graph } from "@gltfi/ir";
import { emitModule } from "@gltfi/emit-ts";
import { parseModule } from "@gltfi/parse-ts";
import { checkEquivalence } from "./equivalence.js";

const FIXTURE_GRAPH: Graph = {
  types: [{ signature: "float" }],
  declarations: [{ op: "event/onStart" }, { op: "math/add" }],
  variables: [{ id: "counter", type: 0, value: [0] }],
  nodes: [{ declaration: 0 }, { declaration: 1, values: { a: { type: 0, value: [1] }, b: { type: 0, value: [2] } } }]
};

function reparse(code: string) {
  const { module, diagnostics } = parseModule(code);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return module;
}

describe("checkEquivalence (UX-703/UX-710)", () => {
  it("reports EQUIV for an unedited round trip (graph -> emit -> parse -> export)", () => {
    const { module } = importGraph(FIXTURE_GRAPH);
    const { code } = emitModule(module, { flavor: "ts" });
    const reparsed = reparse(code);
    expect(checkEquivalence(FIXTURE_GRAPH, reparsed)).toEqual({ status: "equiv" });
  });

  it("reports DIVERGED once the parsed code's logic differs from the graph", () => {
    const { module } = importGraph(FIXTURE_GRAPH);
    const { code } = emitModule(module, { flavor: "ts" });
    const marker = "rt.onStart(() => {";
    const insertAt = code.indexOf(marker) + marker.length;
    const edited = `${code.slice(0, insertAt)}\n    V.counter = V.counter + 1;${code.slice(insertAt)}`;
    const reparsed = reparse(edited);
    const result = checkEquivalence(FIXTURE_GRAPH, reparsed);
    expect(result.status).toBe("diverged");
  });
});
