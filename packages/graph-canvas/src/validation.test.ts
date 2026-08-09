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
