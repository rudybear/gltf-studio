import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateInteractivityGraph } from "./validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));
}

describe("validateInteractivityGraph", () => {
  it("reports ok:true with no diagnostics for a well-formed corpus graph", () => {
    const result = validateInteractivityGraph(loadFixture("flow-doN"));
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("attributes a missing-required-config error to its node index (GV027, e.g. variable/set with no variable)", () => {
    const graph = {
      types: [{ signature: "float" }],
      variables: [{ id: "v", type: 0, value: [0] }],
      declarations: [{ op: "variable/set" }],
      nodes: [{ declaration: 0 }]
    };
    const result = validateInteractivityGraph(graph);
    expect(result.ok).toBe(false);
    const nodeDiags = result.byNodeIndex.get(0);
    expect(nodeDiags).toBeDefined();
    expect(nodeDiags!.some((d) => d.code === "GV027")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "GV027")).toBe(true);
  });

  it("never throws on a structurally broken graph; captures the failure as a diagnostic instead", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const garbage = { nodes: "not-an-array" } as any;
    expect(() => validateInteractivityGraph(garbage)).not.toThrow();
    const result = validateInteractivityGraph(garbage);
    expect(result.ok).toBe(false);
  });
});

describe("validateInteractivityGraph: handler target dangling check (GCANVAS-HANDLER-TARGET-MISSING, UX-512)", () => {
  function handlerGraph(op: string, nodeIndexConfig?: number) {
    return {
      types: [],
      declarations: [{ op }],
      nodes: [{ declaration: 0, ...(nodeIndexConfig === undefined ? {} : { configuration: { nodeIndex: { value: [nodeIndexConfig] } } }) }]
    };
  }

  it("flags a nodeIndex at/beyond the document's scene-node count as a warning, attributed to that node's index", () => {
    const result = validateInteractivityGraph(handlerGraph("event/onSelect", 5), 3);
    const diag = result.byNodeIndex.get(0)?.find((d) => d.code === "GCANVAS-HANDLER-TARGET-MISSING");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    // A warning-only finding must not flip the overall ok flag (that's reserved for errors, matching every other diagnostic source here).
    expect(result.ok).toBe(true);
  });

  it("does not flag the -1 'any node' sentinel, even against a tiny document", () => {
    const result = validateInteractivityGraph(handlerGraph("event/onSelect", -1), 0);
    expect(result.diagnostics.some((d) => d.code === "GCANVAS-HANDLER-TARGET-MISSING")).toBe(false);
  });

  it("does not flag a nodeIndex within the document's real scene-node range", () => {
    const result = validateInteractivityGraph(handlerGraph("event/onHoverIn", 2), 3);
    expect(result.diagnostics.some((d) => d.code === "GCANVAS-HANDLER-TARGET-MISSING")).toBe(false);
  });

  it("skips this check entirely when the caller passes no sceneNodeCount (e.g. packages/agent-mock's isolated validation)", () => {
    const result = validateInteractivityGraph(handlerGraph("event/onSelect", 999));
    expect(result.diagnostics.some((d) => d.code === "GCANVAS-HANDLER-TARGET-MISSING")).toBe(false);
  });

  it("never flags a non-handler op's own config, even if it happens to have a field named nodeIndex-like shape", () => {
    const result = validateInteractivityGraph({ types: [], declarations: [{ op: "math/add" }], nodes: [{ declaration: 0 }] }, 0);
    expect(result.diagnostics.some((d) => d.code === "GCANVAS-HANDLER-TARGET-MISSING")).toBe(false);
  });
});
