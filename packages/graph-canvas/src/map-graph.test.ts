// Lifted (with import-path updates only) from the source VS Code extension's
// test/mapGraph.test.ts — mapGraph itself is ported verbatim (map-graph.ts),
// so its existing test coverage carries over unchanged in intent.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapGraph, type InteractivityGraph, type MappedGraph } from "./map-graph.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "fixtures");

function loadFixture(name: string): InteractivityGraph {
  const text = readFileSync(path.join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(text) as InteractivityGraph;
}

// Structural invariant every fixture must satisfy: the edge count derived by
// mapGraph must equal an independent count of raw flow refs + raw value refs
// in the source JSON.
function expectedEdgeCount(graph: InteractivityGraph): number {
  let count = 0;
  for (const node of graph.nodes) {
    count += Object.keys(node.flows ?? {}).length;
    for (const v of Object.values(node.values ?? {})) {
      if (v && typeof v === "object" && "node" in v) count += 1;
    }
  }
  return count;
}

function findNode(mapped: MappedGraph, index: number) {
  const node = mapped.nodes.find((n) => n.index === index);
  if (!node) throw new Error(`node ${index} not found`);
  return node;
}

function findPort(node: ReturnType<typeof findNode>, kind: string, name: string) {
  const port = node.ports.find((p) => p.kind === kind && p.name === name);
  if (!port) throw new Error(`port ${kind}:${name} not found on node ${node.index} (${node.op})`);
  return port;
}

describe("mapGraph: flow/doN fixture", () => {
  const graph = loadFixture("flow-doN");
  const mapped = mapGraph(graph, 0);

  it("maps node/edge counts", () => {
    expect(mapped.nodeCount).toBe(85);
    expect(mapped.nodes).toHaveLength(85);
    expect(mapped.edgeCount).toBe(expectedEdgeCount(graph));
    expect(mapped.variableCount).toBe(graph.variables?.length ?? 0);
    expect(mapped.eventCount).toBe(3);
  });

  it("maps node 0 (flow/doN) with correct ports, literal, and resolved types", () => {
    const node = findNode(mapped, 0);
    expect(node.op).toBe("flow/doN");
    expect(node.category).toBe("flow");
    expect(node.label).toBe("doN");
    expect(node.knownSpec).toBe(true);

    findPort(node, "flow-in", "in");
    findPort(node, "flow-in", "reset");
    findPort(node, "flow-out", "out");
    expect(findPort(node, "value-in", "n").type).toBe("int");
    expect(findPort(node, "value-out", "currentCount").type).toBe("int");

    expect(node.literals.n).toEqual({ type: "int", value: [5] });
  });

  it("maps node 27 (math/eq) reading node 0's currentCount output", () => {
    const node = findNode(mapped, 27);
    expect(node.op).toBe("math/eq");
    expect(node.category).toBe("math");
    expect(findPort(node, "value-in", "a").type).toBe("int");
    expect(findPort(node, "value-in", "b").type).toBe("int");
    expect(findPort(node, "value-out", "value").type).toBe("bool");

    const edge = mapped.edges.find((e) => e.kind === "value" && e.sourceNode === 0 && e.targetNode === 27);
    expect(edge).toBeDefined();
    expect(edge?.sourcePort).toBe("value-out:currentCount");
    expect(edge?.targetPort).toBe("value-in:a");
    expect(edge?.type).toBe("int");
  });

  it("maps node 30 (debug/log) with dynamic message-parameter ports from presence", () => {
    const node = findNode(mapped, 30);
    expect(node.op).toBe("debug/log");
    expect(findPort(node, "value-in", "0").type).toBe("int");
    expect(node.literals["1"]).toEqual({ type: "int", value: [5] });
  });

  it("maps node 33 (variable/set) with subtitle and config-resolved type", () => {
    const node = findNode(mapped, 33);
    expect(node.op).toBe("variable/set");
    expect(node.subtitle).toBe("TestResult_flow/doN_[currentCount]");
    expect(findPort(node, "value-in", "5").type).toBe("int");
  });

  it("produces no warnings for a well-formed corpus asset", () => {
    expect(mapped.warnings).toEqual([]);
  });
});

describe("mapGraph: event/send_and_receive fixture", () => {
  const graph = loadFixture("event-send_and_receive");
  const mapped = mapGraph(graph, 0);

  it("maps node/edge counts", () => {
    expect(mapped.nodeCount).toBe(graph.nodes.length);
    expect(mapped.edgeCount).toBe(expectedEdgeCount(graph));
  });

  it("resolves event/send's subtitle from the event declaration table", () => {
    const node = findNode(mapped, 0);
    expect(node.op).toBe("event/send");
    expect(node.category).toBe("event");
    expect(node.subtitle).toBe("_eventWithoutParametersb6d646f8-2845-4396-bf78-97c3d53c1870");
  });

  it("gives event/send and event/receive nodes their fixed spec-declared value ports", () => {
    const receiveNode = mapped.nodes.find((n) => n.op === "event/receive");
    expect(receiveNode).toBeDefined();
    findPort(receiveNode!, "value-out", "boolParameter");
    findPort(receiveNode!, "value-out", "intParameter");
    findPort(receiveNode!, "value-out", "floatParameter");
    findPort(receiveNode!, "value-out", "expectedDuration");
    expect(findPort(receiveNode!, "value-out", "boolParameter").type).toBe("bool");
  });
});

describe("mapGraph: handlerTarget (event/onSelect|onHoverIn|onHoverOut, UX-512/UX-513)", () => {
  function graphWith(op: string, configuration?: Record<string, { value: Array<number | boolean> }>): InteractivityGraph {
    return {
      types: [],
      declarations: [{ op }],
      nodes: [{ declaration: 0, ...(configuration ? { configuration } : {}) }]
    };
  }

  it("extracts nodeIndex + stopPropagation for event/onSelect", () => {
    const mapped = mapGraph(graphWith("event/onSelect", { nodeIndex: { value: [3] }, stopPropagation: { value: [true] } }));
    expect(findNode(mapped, 0).handlerTarget).toEqual({ nodeIndex: 3, stopPropagation: true });
  });

  it("extracts nodeIndex + stopPropagation for event/onHoverIn and event/onHoverOut", () => {
    for (const op of ["event/onHoverIn", "event/onHoverOut"]) {
      const mapped = mapGraph(graphWith(op, { nodeIndex: { value: [7] } }));
      expect(findNode(mapped, 0).handlerTarget).toEqual({ nodeIndex: 7, stopPropagation: false });
    }
  });

  it("defaults nodeIndex to -1 (the registry's own 'any node' sentinel) and stopPropagation to false when configuration is absent entirely (e.g. added blank from the palette)", () => {
    const mapped = mapGraph(graphWith("event/onSelect"));
    expect(findNode(mapped, 0).handlerTarget).toEqual({ nodeIndex: -1, stopPropagation: false });
  });

  it("does not set handlerTarget for a non-handler op", () => {
    const mapped = mapGraph(graphWith("math/add"));
    expect(findNode(mapped, 0).handlerTarget).toBeUndefined();
  });
});

describe("mapGraph: subtitleMissing (dangling variable/event index vs. a valid-but-anonymous declaration, UX-514)", () => {
  function graphWith(op: string, configuration: Record<string, { value: Array<number> }>, extra: Partial<InteractivityGraph> = {}): InteractivityGraph {
    return {
      types: [{ signature: "float" }],
      declarations: [{ op }],
      nodes: [{ declaration: 0, configuration }],
      ...extra
    };
  }

  it("variable/get with an out-of-range variable index: subtitle carries the ⚠ missing marker and subtitleMissing is true", () => {
    const mapped = mapGraph(graphWith("variable/get", { variable: { value: [5] } }, { variables: [] }));
    const node = findNode(mapped, 0);
    expect(node.subtitle).toBe("⚠ missing (var#5)");
    expect(node.subtitleMissing).toBe(true);
  });

  it("variable/get with a valid index but no declared id: falls back to var#N, not flagged missing", () => {
    const mapped = mapGraph(graphWith("variable/get", { variable: { value: [0] } }, { variables: [{ type: 0, value: [0] }] }));
    const node = findNode(mapped, 0);
    expect(node.subtitle).toBe("var#0");
    expect(node.subtitleMissing).toBeUndefined();
  });

  it("variable/set: subtitleMissing is true when ANY of its variable slots is dangling", () => {
    const mapped = mapGraph(
      graphWith("variable/set", { variables: { value: [0, 9] } }, { variables: [{ id: "ok", type: 0, value: [0] }] })
    );
    const node = findNode(mapped, 0);
    expect(node.subtitle).toBe("ok, ⚠ missing (var#9)");
    expect(node.subtitleMissing).toBe(true);
  });

  it("event/receive with an out-of-range event index: subtitle carries the ⚠ missing marker", () => {
    const mapped = mapGraph(graphWith("event/receive", { event: { value: [2] } }, { events: [] }));
    const node = findNode(mapped, 0);
    expect(node.subtitle).toBe("⚠ missing (event#2)");
    expect(node.subtitleMissing).toBe(true);
  });
});

describe("mapGraph: pointer/set_and_get fixture", () => {
  const graph = loadFixture("pointer-set_and_get");
  const mapped = mapGraph(graph, 0);

  it("maps node/edge counts", () => {
    expect(mapped.nodeCount).toBe(graph.nodes.length);
    expect(mapped.edgeCount).toBe(expectedEdgeCount(graph));
  });

  it("resolves pointer/set's value type from config.type and subtitle from config.pointer", () => {
    const node = findNode(mapped, 1);
    expect(node.op).toBe("pointer/set");
    expect(node.category).toBe("pointer");
    expect(node.subtitle).toBe("/extensions/KHR_lights_punctual/lights/[lightIndex]/color");
    expect(findPort(node, "value-in", "value").type).toBe("float3");
    expect(findPort(node, "value-in", "lightIndex").type).toBe("int");
  });
});
