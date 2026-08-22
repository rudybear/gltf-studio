import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyCommand } from "./document.js";
import { applyPatches } from "./patch.js";
import { deepEqualJson } from "./json-pointer.js";
import { AudioGraphEdit, type AudioGraphSpec } from "./audio-graph-edit.js";
import { fixtureDocument, fixtureGltfJson } from "./test-fixtures.js";
import type { Command } from "./command.js";
import type { EditorDocument } from "./document.js";

/** Shared round-trip assertion (DOC-007/DOC-008), mirroring graph-edit.test.ts's own helper. */
function expectRoundTrip(before: unknown, command: Pick<Command, "patches" | "inverse">): unknown {
  const after = applyPatches(before, command.patches);
  const restored = applyPatches(after, command.inverse);
  expect(deepEqualJson(restored, before)).toBe(true);
  return after;
}

function audioGraph0(json: unknown): AudioGraphSpec {
  return (json as { extensions: { KHR_audio_graph: { graphs: AudioGraphSpec[] } } }).extensions.KHR_audio_graph.graphs[0];
}

/** A document with a small, real KHR_audio_graph: source(0) -> gain(0) -> filter(1) -> emitter(0), plus a spare unwired oscillator(2). */
function docWithAudioGraph(): EditorDocument {
  const base = fixtureGltfJson() as Record<string, unknown>;
  return fixtureDocument({
    ...base,
    extensionsUsed: [...(base.extensionsUsed as string[]), "KHR_audio_graph"],
    extensions: {
      ...(base.extensions as object),
      KHR_audio_graph: {
        graphs: [
          {
            nodes: [
              { kind: "gain", label: "gainA", params: { gain: 0.5 } },
              { kind: "lowpass", label: "filterB", params: { frequency: 800 } },
              { kind: "oscillator", label: "oscC", params: { type: "sine", frequency: 440 } }
            ],
            connections: [{ from: { node: 0, output: 0 }, to: { node: 1, input: 0 } }],
            inputs: [{ source: 0, node: 0, input: 0 }],
            outputs: [{ node: 1, output: 0, emitter: 0 }]
          }
        ]
      }
    }
  });
}

describe("AudioGraphEdit.ensureGraph (DOC-056)", () => {
  it("is a no-op when a graph already exists at the index", () => {
    const doc = docWithAudioGraph();
    const command = AudioGraphEdit.ensureGraph(doc, 0);
    expect(command.patches).toEqual([]);
    expect(command.inverse).toEqual([]);
  });

  it("scaffolds extensions.KHR_audio_graph + extensionsUsed from nothing", () => {
    const doc = fixtureDocument();
    const before = doc.json;
    const command = AudioGraphEdit.ensureGraph(doc, 0);
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after)).toEqual({ nodes: [], connections: [] });
    expect((after as { extensionsUsed: string[] }).extensionsUsed).toContain("KHR_audio_graph");
  });
});

describe("AudioGraphEdit.addNode (DOC-057)", () => {
  it("appends a node with kind/params and round-trips via inverse", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.addNode(doc, 0, "delay", { delayTime: 0.2 }, { label: "delayD", position: { x: 5, y: 6 } });
    expect(command.label).toContain("delay");
    const after = expectRoundTrip(before, command);
    const g = audioGraph0(after);
    const newNode = g.nodes[g.nodes.length - 1];
    expect(newNode).toMatchObject({ kind: "delay", label: "delayD", params: { delayTime: 0.2 }, extras: { gltfi: { x: 5, y: 6 } } });
  });

  it("throws when the graph does not exist yet", () => {
    const doc = fixtureDocument();
    expect(() => AudioGraphEdit.addNode(doc, 0, "gain", {})).toThrow(/No KHR_audio_graph graph/);
  });
});

describe("AudioGraphEdit.removeNode (DOC-057)", () => {
  it("removes the node and shifts every surviving connections/inputs/outputs node reference above it down by one", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    // Remove node 0 ("gainA"): connections[0] (0->1) references it directly and is dropped;
    // inputs[0] (source 0 -> node 0) is dropped; outputs[0] (node 1 -> emitter 0) survives, shifted 1->0.
    const command = AudioGraphEdit.removeNode(doc, 0, 0);
    const after = expectRoundTrip(before, command);
    const g = audioGraph0(after);
    expect(g.nodes.map((n) => n.label)).toEqual(["filterB", "oscC"]);
    expect(g.connections).toEqual([]);
    expect(g.inputs).toEqual([]);
    expect(g.outputs).toEqual([{ node: 0, output: 0, emitter: 0 }]);
  });

  it("removing an unreferenced node only shifts indices strictly above it", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    // Remove node 2 ("oscC", unwired): nothing references index 2, and nothing above it exists to shift.
    const command = AudioGraphEdit.removeNode(doc, 0, 2);
    const after = expectRoundTrip(before, command);
    const g = audioGraph0(after);
    expect(g.nodes.map((n) => n.label)).toEqual(["gainA", "filterB"]);
    expect(g.connections).toEqual([{ from: { node: 0, output: 0 }, to: { node: 1, input: 0 } }]);
    expect(g.inputs).toEqual([{ source: 0, node: 0, input: 0 }]);
    expect(g.outputs).toEqual([{ node: 1, output: 0, emitter: 0 }]);
  });

  it("via applyCommand: dirties only the owning graph root", () => {
    const doc = docWithAudioGraph();
    const command = AudioGraphEdit.removeNode(doc, 0, 2);
    const after = applyCommand(doc, command);
    expect([...after.dirtyRoots]).toEqual(["/extensions/KHR_audio_graph/graphs/0"]);
  });
});

describe("AudioGraphEdit.connectAudio / disconnectAudio (DOC-059)", () => {
  it("connects node -> node, overwriting any prior connection into the same input", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    // Rewire filterB's input from gainA to oscC instead.
    const command = AudioGraphEdit.connectAudio(doc, 0, { kind: "node", index: 2 }, { kind: "node", index: 1, input: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).connections).toEqual([{ from: { node: 2, output: 0 }, to: { node: 1, input: 0 } }]);
  });

  it("connects source -> node into inputs[]", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.connectAudio(doc, 0, { kind: "source", sourceIndex: 0 }, { kind: "node", index: 2, input: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).inputs).toEqual(
      expect.arrayContaining([{ source: 0, node: 2, input: 0 }])
    );
  });

  it("connects node -> emitter into outputs[], overwriting any prior producer for that emitter", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.connectAudio(doc, 0, { kind: "node", index: 0 }, { kind: "emitter", emitterIndex: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).outputs).toEqual([{ node: 0, output: 0, emitter: 0 }]);
  });

  it("rejects a direct source -> emitter connection", () => {
    const doc = docWithAudioGraph();
    expect(() => AudioGraphEdit.connectAudio(doc, 0, { kind: "source", sourceIndex: 0 }, { kind: "emitter", emitterIndex: 0 })).toThrow(
      /cannot connect a KHR_audio_emitter source directly/
    );
  });

  it("disconnects a node -> node connection", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.disconnectAudio(doc, 0, { kind: "node", index: 1, input: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).connections).toEqual([]);
  });

  it("disconnects a source -> node input binding", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.disconnectAudio(doc, 0, { kind: "node", index: 0, input: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).inputs).toEqual([]);
  });

  it("disconnects a node -> emitter output binding", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.disconnectAudio(doc, 0, { kind: "emitter", emitterIndex: 0 });
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).outputs).toEqual([]);
  });

  it("throws when nothing is wired into the target", () => {
    const doc = docWithAudioGraph();
    expect(() => AudioGraphEdit.disconnectAudio(doc, 0, { kind: "node", index: 2, input: 0 })).toThrow(/nothing wired into/);
  });
});

describe("AudioGraphEdit.setNodeParam (DOC-057)", () => {
  it("sets a param, overwriting any prior value, and round-trips", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.setNodeParam(doc, 0, 0, "gain", 0.9);
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).nodes[0].params).toEqual({ gain: 0.9 });
  });

  it("adds a new param key that did not exist before", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.setNodeParam(doc, 0, 1, "qualityFactor", 2.5);
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).nodes[1].params).toEqual({ frequency: 800, qualityFactor: 2.5 });
  });
});

describe("AudioGraphEdit.setNodePosition (DOC-058)", () => {
  it("sets extras.gltfi.{x,y} on the node and round-trips", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.setNodePosition(doc, 0, 0, 12, 34);
    expect(command.coalesceKey).toBe("audio-node-position:0:0");
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).nodes[0].extras).toEqual({ gltfi: { x: 12, y: 34 } });
  });
});

describe("AudioGraphEdit.setNodeBypass (DOC-063)", () => {
  it("sets bypass=true on the node and round-trips", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const command = AudioGraphEdit.setNodeBypass(doc, 0, 0, true);
    expect(command.coalesceKey).toBe("audio-node-bypass:0:0");
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after).nodes[0].bypass).toBe(true);
  });

  it("un-sets bypass back to false and round-trips", () => {
    const doc = docWithAudioGraph();
    const withBypass = applyPatches(doc.json, AudioGraphEdit.setNodeBypass(doc, 0, 0, true).patches);
    const docWithBypass: EditorDocument = { ...doc, json: withBypass };
    const command = AudioGraphEdit.setNodeBypass(docWithBypass, 0, 0, false);
    const after = expectRoundTrip(withBypass, command);
    expect(audioGraph0(after).nodes[0].bypass).toBe(false);
  });

  it("throws for a nonexistent node index", () => {
    const doc = docWithAudioGraph();
    expect(() => AudioGraphEdit.setNodeBypass(doc, 0, 99, true)).toThrow(/No audio-graph node/);
  });
});

describe("AudioGraphEdit.replaceAudioGraph (DOC-064)", () => {
  it("replaces the whole graph root with a single replace patch and round-trips via the inverse", () => {
    const doc = docWithAudioGraph();
    const before = doc.json;
    const newGraph: AudioGraphSpec = {
      nodes: [{ kind: "gain", params: { gain: 0.9 } }],
      connections: [],
      outputs: [{ node: 0, output: 0, emitter: 0 }]
    };
    const command = AudioGraphEdit.replaceAudioGraph(doc, 0, newGraph);
    expect(command.label).toBe("Apply audio script");
    expect(command.patches).toEqual([{ op: "replace", path: "/extensions/KHR_audio_graph/graphs/0", value: newGraph }]);
    const after = expectRoundTrip(before, command);
    expect(audioGraph0(after)).toEqual(newGraph);
  });

  it("throws when the target graph doesn't exist yet", () => {
    const doc = fixtureDocument();
    expect(() => AudioGraphEdit.replaceAudioGraph(doc, 0, { nodes: [], connections: [] })).toThrow(/No KHR_audio_graph graph/);
  });
});

describe("AudioGraphEdit property: add/connect/param/remove sequences undo back to the initial document", () => {
  it("any sequence of edits, undone in reverse via each command's own inverse, restores the exact original JSON", () => {
    const kinds = ["gain", "lowpass", "delay", "oscillator"] as const;
    const editArb = fc.oneof(
      fc.record({ tag: fc.constant("add" as const), kind: fc.constantFrom(...kinds), gain: fc.float({ min: 0, max: 2, noNaN: true }) }),
      fc.record({ tag: fc.constant("param" as const), nodeIndex: fc.nat(2), value: fc.float({ min: -10, max: 10, noNaN: true }) }),
      fc.record({ tag: fc.constant("connect" as const), fromIndex: fc.nat(2), toIndex: fc.nat(2) }),
      fc.record({ tag: fc.constant("position" as const), nodeIndex: fc.nat(2), x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
      fc.record({ tag: fc.constant("bypass" as const), nodeIndex: fc.nat(2), bypass: fc.boolean() })
    );

    fc.assert(
      fc.property(fc.array(editArb, { minLength: 1, maxLength: 8 }), (edits) => {
        const doc = docWithAudioGraph();
        const initial = doc.json;
        let working = doc;
        const applied: Command[] = [];

        for (const edit of edits) {
          const graph = audioGraph0(working.json);
          let command: Command;
          try {
            if (edit.tag === "add") {
              command = AudioGraphEdit.addNode(working, 0, edit.kind, { gain: edit.gain });
            } else if (edit.tag === "param") {
              if (edit.nodeIndex >= graph.nodes.length) continue;
              command = AudioGraphEdit.setNodeParam(working, 0, edit.nodeIndex, "gain", edit.value);
            } else if (edit.tag === "connect") {
              if (edit.fromIndex >= graph.nodes.length || edit.toIndex >= graph.nodes.length || edit.fromIndex === edit.toIndex) continue;
              command = AudioGraphEdit.connectAudio(working, 0, { kind: "node", index: edit.fromIndex }, { kind: "node", index: edit.toIndex, input: 0 });
            } else if (edit.tag === "position") {
              if (edit.nodeIndex >= graph.nodes.length) continue;
              command = AudioGraphEdit.setNodePosition(working, 0, edit.nodeIndex, edit.x, edit.y);
            } else {
              if (edit.nodeIndex >= graph.nodes.length) continue;
              command = AudioGraphEdit.setNodeBypass(working, 0, edit.nodeIndex, edit.bypass);
            }
          } catch {
            continue; // a rejected/invalid edit for this random combination — skip, not a failure of the property
          }
          applied.push(command);
          working = { ...working, json: applyPatches(working.json, command.patches) };
        }

        // Undo every applied command in REVERSE order via its own inverse.
        let undone = working.json;
        for (const command of [...applied].reverse()) {
          undone = applyPatches(undone, command.inverse);
        }
        expect(deepEqualJson(undone, initial)).toBe(true);
      })
    );
  });
});
