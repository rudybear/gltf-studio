import { describe, expect, it } from "vitest";
import { applyCommand } from "./document.js";
import { applyPatches } from "./patch.js";
import { deepEqualJson } from "./json-pointer.js";
import { GraphEdit } from "./graph-edit.js";
import { fixtureDocument } from "./test-fixtures.js";
import type { Command } from "./command.js";
import type { EditorDocument } from "./document.js";

type Graph = { declarations: Array<{ op: string }>; nodes: unknown[]; variables?: unknown[]; events?: unknown[] };

function graph0(json: unknown): Graph {
  return (json as { extensions: { KHR_interactivity: { graphs: Graph[] } } }).extensions.KHR_interactivity.graphs[0];
}

/** Shared round-trip assertion for every factory below (DOC-007/DOC-008 shape, DOC-032's core mechanism). */
function expectRoundTrip(before: unknown, command: Pick<Command, "patches" | "inverse">): unknown {
  const after = applyPatches(before, command.patches);
  const restored = applyPatches(after, command.inverse);
  expect(deepEqualJson(restored, before)).toBe(true);
  return after;
}

describe("GraphEdit.ensureDeclaration (DOC-021)", () => {
  it("returns the existing index and a no-op command when the declaration already exists", () => {
    const doc = fixtureDocument();
    const { command, index } = GraphEdit.ensureDeclaration(doc, 0, "event/onStart");
    expect(index).toBe(0);
    expect(command.patches).toEqual([]);
    expect(command.inverse).toEqual([]);
  });

  it("appends a new declaration and returns its fresh index otherwise", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const { command, index } = GraphEdit.ensureDeclaration(doc, 0, "math/multiply");
    expect(index).toBe(graph0(before).declarations.length);
    const after = expectRoundTrip(before, command);
    expect(graph0(after).declarations[index]).toEqual({ op: "math/multiply" });
  });
});

describe("GraphEdit.addNode (DOC-007..010, DOC-027)", () => {
  it("declares the op and appends a node in one command; round-trips via inverse", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addNode(doc, 0, "math/multiply", { position: { x: 10, y: 20 } });
    expect(command.label).toContain("math/multiply");
    expect(typeof command.id).toBe("string");

    const after = expectRoundTrip(doc.json, command);
    const g = graph0(after);
    const newIndex = g.nodes.length - 1;
    const newDeclIndex = g.declarations.length - 1;
    expect(g.declarations[newDeclIndex]).toEqual({ op: "math/multiply" });
    expect(g.nodes[newIndex]).toMatchObject({ declaration: newDeclIndex, extras: { gltfi: { x: 10, y: 20 } } });
  });

  it("reuses an existing declaration instead of adding a duplicate", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const command = GraphEdit.addNode(doc, 0, "event/onStart");
    const after = expectRoundTrip(before, command);
    expect(graph0(after).declarations.length).toBe(graph0(before).declarations.length); // no new declaration
    expect(graph0(after).nodes.length).toBe(graph0(before).nodes.length + 1);
  });

  it("via applyCommand: dirties only the owning graph root, not the whole extensions object", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addNode(doc, 0, "math/multiply");
    const after = applyCommand(doc, command);
    expect([...after.dirtyRoots]).toEqual(["/extensions/KHR_interactivity/graphs/0"]);
  });
});

describe("GraphEdit.removeNode (DOC-019, DOC-021)", () => {
  function docWithGraph(nodes: unknown[]): ReturnType<typeof fixtureDocument> {
    return fixtureDocument({
      asset: { version: "2.0" },
      extensions: {
        KHR_interactivity: {
          graph: 0,
          graphs: [{ types: [], declarations: [{ op: "a" }, { op: "b" }, { op: "c" }], nodes }]
        }
      }
    });
  }

  it("removes the node and shifts every surviving values/flows reference above it down by one", () => {
    const doc = docWithGraph([
      { declaration: 0 }, // index 0: removed
      { declaration: 1, flows: { out: { node: 2, socket: "in" } } }, // ref above removed -> shifts 2 -> 1
      { declaration: 2 } // index 2
    ]);
    const before = doc.json;
    const command = GraphEdit.removeNode(doc, 0, 0);
    const after = expectRoundTrip(before, command);
    const g = graph0(after);
    expect(g.nodes.length).toBe(2);
    expect((g.nodes[0] as { flows: { out: { node: number } } }).flows.out.node).toBe(1);
  });

  it("leaves a dangling reference to the removed node itself untouched (not repaired, not shifted)", () => {
    const doc = docWithGraph([
      { declaration: 0 }, // index 0: removed
      { declaration: 1, values: { a: { node: 0, socket: "out" } } } // dangling ref to the removed node
    ]);
    const command = GraphEdit.removeNode(doc, 0, 0);
    const after = applyPatches(doc.json, command.patches);
    const g = graph0(after);
    expect((g.nodes[0] as { values: { a: { node: number } } }).values.a.node).toBe(0); // untouched
  });
});

describe("GraphEdit.connectFlow / connectValue / disconnect / setLiteral", () => {
  it("connectFlow wires a flow socket and inverse removes it", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.connectFlow(doc, 0, 0, "out", 1, "in");
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).nodes[0]).toMatchObject({ flows: { out: { node: 1, socket: "in" } } });
  });

  it("connectFlow's inverse restores a PRIOR wire (not just removal) when overwriting an existing connection", () => {
    const doc = fixtureDocument();
    const wired = applyCommand(doc, GraphEdit.connectFlow(doc, 0, 0, "out", 1, "in"));
    const rewire = GraphEdit.connectFlow(wired, 0, 0, "out", 0, "in"); // rewire the same socket to a different target
    const flowPath = "/extensions/KHR_interactivity/graphs/0/nodes/0/flows/out";
    expect(rewire.patches).toEqual([{ op: "replace", path: flowPath, value: { node: 0, socket: "in" } }]);
    expect(rewire.inverse).toEqual([{ op: "replace", path: flowPath, value: { node: 1, socket: "in" } }]); // the PRIOR wire, not a bare removal
    expectRoundTrip(wired.json, rewire);
  });

  it("connectValue wires a value socket referencing another node", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.connectValue(doc, 0, 1, "a", 0, "out");
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).nodes[1]).toMatchObject({ values: { a: { node: 0, socket: "out" } } });
  });

  it("disconnect removes a wired flow/value and inverse restores it", () => {
    const doc = fixtureDocument();
    const wired = applyCommand(doc, GraphEdit.connectFlow(doc, 0, 0, "out", 1, "in"));
    const command = GraphEdit.disconnect(wired, 0, 0, "out", "flow");
    const after = expectRoundTrip(wired.json, command);
    expect((graph0(after).nodes[0] as { flows?: unknown }).flows).toEqual({});
  });

  it("setLiteral sets a values[socket] literal and round-trips", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.setLiteral(doc, 0, 1, "b", { type: 0, value: [42] });
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).nodes[1]).toMatchObject({ values: { b: { type: 0, value: [42] } } });
  });
});

describe("GraphEdit.setNodePosition (DOC-027)", () => {
  it("stores {x,y} at node.extras.gltfi and round-trips", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.setNodePosition(doc, 0, 0, 12, 34);
    expect(command.coalesceKey).toBe("node-position:0:0");
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).nodes[0]).toMatchObject({ extras: { gltfi: { x: 12, y: 34 } } });
  });
});

describe("GraphEdit.ensureGraph (DOC-041)", () => {
  it("returns a no-op command when the graph already exists", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.ensureGraph(doc, 0);
    expect(command.patches).toEqual([]);
    expect(command.inverse).toEqual([]);
  });

  it("scaffolds extensions.KHR_interactivity.graphs[0] plus extensionsUsed when the extension is entirely absent, and round-trips", () => {
    const doc = fixtureDocument({ asset: { version: "2.0" }, nodes: [{ name: "Alpha" }] });
    const before = doc.json;
    const command = GraphEdit.ensureGraph(doc, 0);
    const after = expectRoundTrip(before, command) as {
      extensionsUsed?: string[];
      extensions: { KHR_interactivity: { graph: number; graphs: Graph[] } };
    };
    expect(after.extensionsUsed).toContain("KHR_interactivity");
    expect(after.extensions.KHR_interactivity.graph).toBe(0);
    expect(after.extensions.KHR_interactivity.graphs[0]).toEqual({
      types: [],
      declarations: [],
      variables: [],
      events: [],
      nodes: []
    });
  });

  it("does not disturb extensionsUsed when KHR_interactivity is already listed", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_interactivity"],
      extensions: { KHR_interactivity: { graph: 0, graphs: [] } }
    });
    const before = doc.json;
    const command = GraphEdit.ensureGraph(doc, 0);
    const after = expectRoundTrip(before, command) as { extensionsUsed: string[] };
    expect(after.extensionsUsed).toEqual(["KHR_interactivity"]);
  });
});

describe("GraphEdit.ensureType (DOC-042)", () => {
  it("returns the existing index and a no-op command when the signature already exists", () => {
    const doc = fixtureDocument();
    expect(graph0(doc.json).declarations).toBeDefined(); // sanity: graph 0 exists in the fixture
    const { command, index } = GraphEdit.ensureType(doc, 0, "float");
    expect(index).toBe(0);
    expect(command.patches).toEqual([]);
  });

  it("appends a new signature and returns its fresh index otherwise", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const { command, index } = GraphEdit.ensureType(doc, 0, "float3");
    expect(index).toBe(2); // fixture already has ["float", "bool"]
    const after = expectRoundTrip(before, command) as { extensions: { KHR_interactivity: { graphs: Array<{ types: Array<{ signature: string }> }> } } };
    expect(after.extensions.KHR_interactivity.graphs[0].types[index]).toEqual({ signature: "float3" });
  });
});

describe("GraphEdit.replaceGraph (DOC-043)", () => {
  it("replaces the whole graph root with a single replace patch and round-trips via the inverse", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const newGraph = {
      types: [{ signature: "float" }],
      declarations: [{ op: "event/onTick" }],
      variables: [],
      events: [],
      nodes: [{ declaration: 0 }]
    };
    const command = GraphEdit.replaceGraph(doc, 0, newGraph as unknown as Parameters<typeof GraphEdit.replaceGraph>[2]);
    expect(command.label).toBe("Apply script");
    expect(command.patches).toEqual([{ op: "replace", path: "/extensions/KHR_interactivity/graphs/0", value: newGraph }]);
    const after = expectRoundTrip(before, command);
    expect(graph0(after)).toEqual(newGraph);
  });

  it("throws when the target graph doesn't exist yet (same precondition as every other factory but ensureGraph)", () => {
    const doc = fixtureDocument({ asset: { version: "2.0" } });
    expect(() => GraphEdit.replaceGraph(doc, 0, { types: [], declarations: [], nodes: [] })).toThrow(/No KHR_interactivity graph/);
  });
});

describe("GraphEdit.addPointerNode (UX-411/UX-412)", () => {
  it("adds a pointer/set node against an EXISTING graph, reusing its types/declarations, as one command", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const command = GraphEdit.addPointerNode(doc, 0, "set", "/nodes/0/translation", "float3", { x: 5, y: 5 });
    const after = expectRoundTrip(before, command);
    const g = graph0(after);
    const newIndex = g.nodes.length - 1;
    const node = g.nodes[newIndex] as { declaration: number; configuration: { pointer: { value: string[] }; type: { value: number[] } } };
    const decl = g.declarations[node.declaration];
    expect(decl).toEqual({ op: "pointer/set" });
    expect(node.configuration.pointer.value).toEqual(["/nodes/0/translation"]);
    const typeIndex = node.configuration.type.value[0];
    expect((g as unknown as { types: Array<{ signature: string }> }).types[typeIndex]).toEqual({ signature: "float3" });
  });

  it("adds a pointer/interpolate node, scaffolding a MISSING graph from scratch, as ONE combined command", () => {
    const doc = fixtureDocument({ asset: { version: "2.0" }, nodes: [{ name: "Alpha" }] });
    const before = doc.json;
    const command = GraphEdit.addPointerNode(doc, 0, "interpolate", "/nodes/0/scale", "float3");
    expect(command.label).toContain("pointer/interpolate");
    const after = expectRoundTrip(before, command) as {
      extensions: { KHR_interactivity: { graphs: Array<{ declarations: Array<{ op: string }>; nodes: unknown[] }> } };
    };
    const g = after.extensions.KHR_interactivity.graphs[0];
    expect(g.declarations).toEqual([{ op: "pointer/interpolate" }]);
    expect(g.nodes.length).toBe(1);
  });

  it("via applyCommand: scaffolding a missing graph dirties the extensions root (its own creation, since `extensions` itself didn't exist yet) AND the graph root (the node/declaration/type appended into it), never the whole document", () => {
    const doc = fixtureDocument({ asset: { version: "2.0" }, nodes: [{ name: "Alpha" }] });
    const command = GraphEdit.addPointerNode(doc, 0, "set", "/nodes/0/translation", "float3");
    const after = applyCommand(doc, command);
    // setPathFragment (edit-fragments.ts) walks up to the deepest EXISTING
    // ancestor when creating a brand new key — this fixture has no
    // `extensions` object at all yet, so ensureGraph's own patch lands at
    // `/extensions` (not `/extensions/KHR_interactivity`); canonicalSpliceRoot
    // (splice-root.ts rule 2) truncates an extension-less `/extensions` add
    // to `/extensions` itself.
    expect([...after.dirtyRoots].sort()).toEqual(["/extensions", "/extensions/KHR_interactivity/graphs/0", "/extensionsUsed"]);
  });

  it('also accepts kind "get" (UX-508 drop-menu), producing a pointer/get declaration', () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const command = GraphEdit.addPointerNode(doc, 0, "get", "/nodes/1/translation", "float3");
    const after = expectRoundTrip(before, command);
    const g = graph0(after);
    const node = g.nodes[g.nodes.length - 1] as { declaration: number };
    expect(g.declarations[node.declaration]).toEqual({ op: "pointer/get" });
  });
});

describe("GraphEdit.setNodeConfig (DOC-044)", () => {
  it("replaces an existing configuration field, round-tripping via inverse", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addPointerNode(doc, 0, "set", "/nodes/0/translation", "float3");
    const afterAdd: EditorDocument = { ...doc, json: applyPatches(doc.json, command.patches) };
    const nodeIndex = graph0(afterAdd.json).nodes.length - 1;

    const before = afterAdd.json;
    const retarget = GraphEdit.setNodeConfig(afterAdd, 0, nodeIndex, "pointer", ["/nodes/1/translation"]);
    const after = expectRoundTrip(before, retarget) as unknown;
    const node = graph0(after).nodes[nodeIndex] as { configuration: { pointer: { value: string[] } } };
    expect(node.configuration.pointer.value).toEqual(["/nodes/1/translation"]);
  });

  it("adds a NEW configuration field when the node has none yet for that key", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addNode(doc, 0, "debug/log");
    const afterAdd: EditorDocument = { ...doc, json: applyPatches(doc.json, command.patches) };
    const nodeIndex = graph0(afterAdd.json).nodes.length - 1;

    const before = afterAdd.json;
    const setMsg = GraphEdit.setNodeConfig(afterAdd, 0, nodeIndex, "message", ["hello"]);
    const after = expectRoundTrip(before, setMsg) as unknown;
    const node = graph0(after).nodes[nodeIndex] as { configuration: { message: { value: string[] } } };
    expect(node.configuration.message.value).toEqual(["hello"]);
  });
});

describe("GraphEdit.addVariable / addCustomEvent", () => {
  it("addVariable appends and round-trips", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addVariable(doc, 0, { id: "v1", type: 0, value: [1] });
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).variables).toEqual([
      { id: "v0", type: 0, value: [0] },
      { id: "v1", type: 0, value: [1] }
    ]);
  });

  it("addCustomEvent appends and round-trips", () => {
    const doc = fixtureDocument();
    const command = GraphEdit.addCustomEvent(doc, 0, { id: "e1" });
    const after = expectRoundTrip(doc.json, command);
    expect(graph0(after).events).toEqual([{ id: "e1" }]);
  });
});
