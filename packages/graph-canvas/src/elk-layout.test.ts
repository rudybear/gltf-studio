// Lifted (import-path updates only) from the source VS Code extension's
// test/elkLayout.test.ts: given a small MappedGraph, assert the ELK input
// has correct port sides/order (WEST: flow-in then value-in, in declaration
// order; EAST: flow-out then value-out) and that a real elkjs layout run
// returns a position for every node — this deliberately bypasses
// layout.worker.ts and imports elkjs's bundled solver directly, same as the
// worker does internally, so it runs synchronously in vitest's Node
// environment with no worker involved.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ElkConstructor from "elkjs/lib/elk.bundled.js";
import { buildElkGraph, eastPorts, elkPortId, extractPositions, westPorts } from "./elk-layout.js";
import { mapGraph, type InteractivityGraph } from "./map-graph.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "fixtures");

function loadFixture(name: string): InteractivityGraph {
  const text = readFileSync(path.join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(text) as InteractivityGraph;
}

describe("elkLayout: buildElkGraph port sides/order (flow/doN fixture)", () => {
  const graph = mapGraph(loadFixture("flow-doN"), 0);
  const elkGraph = buildElkGraph(graph);

  it("root graph declares layered/RIGHT/FIXED_ORDER", () => {
    expect(elkGraph.layoutOptions["elk.algorithm"]).toBe("layered");
    expect(elkGraph.layoutOptions["elk.direction"]).toBe("RIGHT");
    expect(elkGraph.layoutOptions["elk.portConstraints"]).toBe("FIXED_ORDER");
  });

  it("westPorts()/eastPorts() are flow-in/value-in and flow-out/value-out in declaration order", () => {
    expect(graph.nodes.length).toBeGreaterThan(0);
    for (const node of graph.nodes) {
      const west = westPorts(node);
      const east = eastPorts(node);
      expect(west).toHaveLength(node.ports.filter((p) => p.kind === "flow-in" || p.kind === "value-in").length);
      expect(east).toHaveLength(node.ports.filter((p) => p.kind === "flow-out" || p.kind === "value-out").length);

      const flowInCount = node.ports.filter((p) => p.kind === "flow-in").length;
      expect(west.slice(0, flowInCount).every((p) => p.kind === "flow-in")).toBe(true);
      expect(west.slice(flowInCount).every((p) => p.kind === "value-in")).toBe(true);

      const flowOutCount = node.ports.filter((p) => p.kind === "flow-out").length;
      expect(east.slice(0, flowOutCount).every((p) => p.kind === "flow-out")).toBe(true);
      expect(east.slice(flowOutCount).every((p) => p.kind === "value-out")).toBe(true);
    }
  });

  it("every ELK node port gets elk.port.side WEST/EAST matching westPorts/eastPorts, with strictly increasing FIXED_ORDER indices", () => {
    for (const child of elkGraph.children) {
      const nodeIndex = Number(child.id);
      const node = graph.nodes.find((n) => n.index === nodeIndex);
      expect(node, `graph has no node ${nodeIndex}`).toBeDefined();
      const west = westPorts(node!);
      const east = eastPorts(node!);
      const westIds = new Set(west.map((p) => elkPortId(nodeIndex, p.id)));
      const eastIds = new Set(east.map((p) => elkPortId(nodeIndex, p.id)));

      expect(child.ports).toHaveLength(west.length + east.length);
      for (const port of child.ports) {
        if (westIds.has(port.id)) {
          expect(port.layoutOptions["elk.port.side"]).toBe("WEST");
        } else if (eastIds.has(port.id)) {
          expect(port.layoutOptions["elk.port.side"]).toBe("EAST");
        } else {
          throw new Error(`unexpected elk port id ${port.id} on node ${nodeIndex}`);
        }
      }

      const indices = child.ports.map((p) => Number(p.layoutOptions["elk.port.index"]));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
      expect(new Set(indices).size).toBe(indices.length);

      const westIndices = child.ports.filter((p) => westIds.has(p.id)).map((p) => Number(p.layoutOptions["elk.port.index"]));
      const eastIndices = child.ports.filter((p) => eastIds.has(p.id)).map((p) => Number(p.layoutOptions["elk.port.index"]));
      if (westIndices.length > 0 && eastIndices.length > 0) {
        expect(Math.max(...westIndices)).toBeLessThan(Math.min(...eastIndices));
      }
    }
  });

  it("every ELK node declares portConstraints FIXED_ORDER", () => {
    for (const child of elkGraph.children) {
      expect(child.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_ORDER");
    }
  });

  it("edges reference source/target port ids that exist on the corresponding child nodes", () => {
    const allPortIds = new Set(elkGraph.children.flatMap((c) => c.ports.map((p) => p.id)));
    expect(elkGraph.edges.length).toBe(graph.edges.length);
    for (const edge of elkGraph.edges) {
      expect(edge.sources).toHaveLength(1);
      expect(edge.targets).toHaveLength(1);
      expect(allPortIds.has(edge.sources[0]!)).toBe(true);
      expect(allPortIds.has(edge.targets[0]!)).toBe(true);
    }
  });

  it("node width/height are estimated from title/subtitle/port-row counts (never smaller than the minimum box)", () => {
    for (const child of elkGraph.children) {
      expect(child.width).toBeGreaterThanOrEqual(180);
      expect(child.height).toBeGreaterThan(0);
    }
  });
});

describe("elkLayout: a real elkjs layout run returns a position for every node (no worker)", () => {
  it.each(["flow-doN", "event-send_and_receive", "pointer-set_and_get"])("%s fixture", async (fixtureName) => {
    const graph = mapGraph(loadFixture(fixtureName), 0);
    const elkGraph = buildElkGraph(graph);
    const elk = new ElkConstructor();
    const result = await elk.layout(elkGraph);
    const positions = extractPositions(result);

    expect(Object.keys(positions)).toHaveLength(graph.nodes.length);
    for (const node of graph.nodes) {
      const pos = positions[node.index];
      expect(pos, `missing layout position for node ${node.index}`).toBeDefined();
      expect(Number.isFinite(pos!.x)).toBe(true);
      expect(Number.isFinite(pos!.y)).toBe(true);
      expect(pos!.width).toBeGreaterThan(0);
      expect(pos!.height).toBeGreaterThan(0);
    }
  });
});
