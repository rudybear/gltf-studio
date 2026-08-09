import { describe, expect, it } from "vitest";
import { applyPatches } from "./patch.js";
import { deepEqualJson } from "./json-pointer.js";
import { SceneEdit, SceneEditNotImplementedError } from "./scene-edit.js";
import { fixtureDocument } from "./test-fixtures.js";
import type { Command } from "./command.js";

function expectRoundTrip(before: unknown, command: Pick<Command, "patches" | "inverse">): unknown {
  const after = applyPatches(before, command.patches);
  const restored = applyPatches(after, command.inverse);
  expect(deepEqualJson(restored, before)).toBe(true);
  return after;
}

describe("SceneEdit.setTransform", () => {
  it("sets one field and round-trips", () => {
    const doc = fixtureDocument();
    const command = SceneEdit.setTransform(doc, 0, { translation: [5, 6, 7] });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ translation: number[] }> };
    expect(after.nodes[0].translation).toEqual([5, 6, 7]);
  });

  it("sets multiple fields as a single command and round-trips", () => {
    const doc = fixtureDocument();
    const command = SceneEdit.setTransform(doc, 1, { translation: [1, 2, 3], scale: [2, 2, 2] });
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ translation: number[]; scale: number[] }>;
    };
    expect(after.nodes[1].translation).toEqual([1, 2, 3]);
    expect(after.nodes[1].scale).toEqual([2, 2, 2]);
  });

  it("throws on an empty field set", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.setTransform(doc, 0, {})).toThrow();
  });

  it("coalesceKey is scoped per node AND per field set — same field coalesces, different fields on the same node don't (DOC-010/DOC-015)", () => {
    const doc = fixtureDocument();
    const positionA = SceneEdit.setTransform(doc, 0, { translation: [1, 0, 0] });
    const positionB = SceneEdit.setTransform(doc, 0, { translation: [2, 0, 0] });
    const rotation = SceneEdit.setTransform(doc, 0, { rotation: [0, 0, 0, 1] });
    const otherNodePosition = SceneEdit.setTransform(doc, 1, { translation: [1, 0, 0] });

    expect(positionA.coalesceKey).toBe(positionB.coalesceKey); // same node, same field -> coalesces
    expect(positionA.coalesceKey).not.toBe(rotation.coalesceKey); // same node, different field -> does not
    expect(positionA.coalesceKey).not.toBe(otherNodePosition.coalesceKey); // different node -> does not
  });
});

describe("SceneEdit.setName", () => {
  it("renames a node and round-trips", () => {
    const doc = fixtureDocument();
    const command = SceneEdit.setName(doc, 0, "Renamed");
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string }> };
    expect(after.nodes[0].name).toBe("Renamed");
  });
});

describe("SceneEdit.setMaterialProperty", () => {
  it("sets a nested material property and round-trips", () => {
    const doc = fixtureDocument();
    const command = SceneEdit.setMaterialProperty(doc, 0, ["pbrMetallicRoughness", "baseColorFactor"], [0, 1, 0, 1]);
    const after = expectRoundTrip(doc.json, command) as {
      materials: Array<{ pbrMetallicRoughness: { baseColorFactor: number[] } }>;
    };
    expect(after.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([0, 1, 0, 1]);
  });
});

describe("SceneEdit.setAudioEmitterProperty", () => {
  it("sets an emitter property and round-trips", () => {
    const doc = fixtureDocument();
    const command = SceneEdit.setAudioEmitterProperty(doc, 0, ["gain"], 0.5);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_audio_emitter: { emitters: Array<{ gain: number }> } };
    };
    expect(after.extensions.KHR_audio_emitter.emitters[0].gain).toBe(0.5);
  });
});

describe("SceneEdit structural stubs (deferred to M8)", () => {
  it("removeNode/reparentNode throw SceneEditNotImplementedError", () => {
    expect(() => SceneEdit.removeNode()).toThrow(SceneEditNotImplementedError);
    expect(() => SceneEdit.reparentNode()).toThrow(SceneEditNotImplementedError);
    expect(() => SceneEdit.removeNode()).toThrow(/M8/);
  });
});

// DOC-046: minimal append-only structural factories, added ahead of M8 for
// @gltf-studio/agent-mock's procedural asset-generation template.
describe("SceneEdit.addNode (DOC-046)", () => {
  it("appends a node and, by default, adds it to the current default scene as one combined command", () => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[]; scenes: Array<{ nodes: number[] }> };
    const { command, index } = SceneEdit.addNode(doc, { name: "Cube", translation: [1, 0, 0] });
    expect(index).toBe(before.nodes.length);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes[index]).toMatchObject({ name: "Cube", translation: [1, 0, 0] });
    expect(after.scenes[0].nodes).toContain(index);
    expect(after.scenes[0].nodes.length).toBe(before.scenes[0].nodes.length + 1);
  });

  it("does not touch the scene's nodes array when addToScene is false", () => {
    const doc = fixtureDocument();
    const before = doc.json as { scenes: Array<{ nodes: number[] }> };
    const { command } = SceneEdit.addNode(doc, { name: "Detached" }, { addToScene: false });
    const after = expectRoundTrip(doc.json, command) as { scenes: Array<{ nodes: number[] }> };
    expect(after.scenes[0].nodes).toEqual(before.scenes[0].nodes);
  });

  it("is a single combined command: undoing it removes both the node and its scene-membership entry together", () => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[] };
    const { command } = SceneEdit.addNode(doc, { name: "Cube" });
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
    expect((undone as { nodes: unknown[] }).nodes.length).toBe(before.nodes.length);
  });
});

describe("SceneEdit.addMesh / addMaterial / addAccessor / addBufferView / addBuffer (DOC-046)", () => {
  it("addMesh appends to json.meshes and round-trips", () => {
    const doc = fixtureDocument();
    const before = doc.json as { meshes?: unknown[] };
    const { command, index } = SceneEdit.addMesh(doc, { primitives: [{ attributes: { POSITION: 0 } }] });
    expect(index).toBe(before.meshes?.length ?? 0);
    const after = expectRoundTrip(doc.json, command) as { meshes: unknown[] };
    expect(after.meshes.length).toBe((before.meshes?.length ?? 0) + 1);
  });

  it("addMaterial appends to json.materials and round-trips", () => {
    const doc = fixtureDocument();
    const before = doc.json as { materials: unknown[] };
    const { command, index } = SceneEdit.addMaterial(doc, { name: "Generated", pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } });
    expect(index).toBe(before.materials.length);
    const after = expectRoundTrip(doc.json, command) as { materials: Array<{ name: string }> };
    expect(after.materials[index].name).toBe("Generated");
  });

  it("addAccessor appends to json.accessors and round-trips", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addAccessor(doc, { componentType: 5126, count: 24, type: "VEC3" });
    const after = expectRoundTrip(doc.json, command) as { accessors: Array<{ count: number }> };
    expect(after.accessors[index].count).toBe(24);
  });

  it("addBufferView appends to json.bufferViews and round-trips", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addBufferView(doc, { buffer: 0, byteOffset: 0, byteLength: 288 });
    const after = expectRoundTrip(doc.json, command) as { bufferViews: Array<{ byteLength: number }> };
    expect(after.bufferViews[index].byteLength).toBe(288);
  });

  it("addBuffer appends a data-URI buffer to json.buffers and round-trips", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addBuffer(doc, { byteLength: 648, uri: "data:application/octet-stream;base64,AAAA" });
    const after = expectRoundTrip(doc.json, command) as { buffers: Array<{ byteLength: number }> };
    expect(after.buffers[index].byteLength).toBe(648);
  });
});
