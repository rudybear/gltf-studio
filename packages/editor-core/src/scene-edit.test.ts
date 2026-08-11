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

  it("M8-lite: parentNodeIndex appends under that node's children instead of the scene root, as one combined command", () => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[]; scenes: Array<{ nodes: number[] }> };
    const { command, index } = SceneEdit.addNode(doc, { name: "Child" }, { parentNodeIndex: 0 });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes[0].children).toContain(index);
    // Not ALSO added to the scene's root nodes array — it's parented, not scene-rooted.
    expect(after.scenes[0].nodes).toEqual(before.scenes[0].nodes);
  });

  it("M8-lite: parentNodeIndex creates the children array when the parent has none yet", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addNode(doc, { name: "FirstChild" }, { parentNodeIndex: 1 });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[1].children).toEqual([index]);
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

// DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206): composite one-command
// factories behind the scene tree's "+ Add" menu's five real entries.
describe("SceneEdit.addPrimitiveMeshNode (DOC-047)", () => {
  it.each(["cube", "sphere", "plane"] as const)("adds a %s: buffer+bufferViews+accessors+material+mesh+node as one command, at scene root by default", (kind) => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[]; meshes?: unknown[]; scenes: Array<{ nodes: number[] }> };
    const { command, index } = SceneEdit.addPrimitiveMeshNode(doc, kind, `My ${kind}`);
    expect(index).toBe(before.nodes.length);
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; mesh?: number }>;
      meshes: Array<{ name: string; primitives: Array<{ attributes: Record<string, number>; indices: number; material: number }> }>;
      accessors: unknown[];
      bufferViews: unknown[];
      buffers: unknown[];
      scenes: Array<{ nodes: number[] }>;
    };
    expect(after.nodes[index].name).toBe(`My ${kind}`);
    expect(after.scenes[0].nodes).toContain(index);
    const meshIndex = after.nodes[index].mesh!;
    const primitive = after.meshes[meshIndex].primitives[0];
    expect(typeof primitive.attributes.POSITION).toBe("number");
    expect(typeof primitive.attributes.NORMAL).toBe("number");
    expect(typeof primitive.indices).toBe("number");
    expect(typeof primitive.material).toBe("number");
  });

  it("lands under parentNodeIndex instead of scene root when given", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addPrimitiveMeshNode(doc, "cube", "Child Cube", { parentNodeIndex: 0 });
    const before = doc.json as { scenes: Array<{ nodes: number[] }> };
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes[0].children).toContain(index);
    expect(after.scenes[0].nodes).toEqual(before.scenes[0].nodes);
  });

  it("is a single combined command: undoing it removes every appended element together", () => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[]; meshes?: unknown[]; buffers?: unknown[] };
    const { command } = SceneEdit.addPrimitiveMeshNode(doc, "sphere", "Sphere");
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
    expect((undone as { nodes: unknown[] }).nodes.length).toBe(before.nodes.length);
  });
});

describe("SceneEdit.addLightNode (DOC-047)", () => {
  it("scaffolds extensions.KHR_lights_punctual.lights + extensionsUsed + a referencing node, as one command", () => {
    const doc = fixtureDocument();
    const before = doc.json as { extensionsUsed: string[] };
    expect(before.extensionsUsed).not.toContain("KHR_lights_punctual");
    const { command, index } = SceneEdit.addLightNode(doc, "Lamp");
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; extensions?: { KHR_lights_punctual?: { light: number } } }>;
      extensions: { KHR_lights_punctual: { lights: Array<{ type: string }> } };
      extensionsUsed: string[];
      scenes: Array<{ nodes: number[] }>;
    };
    expect(after.extensionsUsed).toContain("KHR_lights_punctual");
    const lightIndex = after.nodes[index].extensions!.KHR_lights_punctual!.light;
    expect(after.extensions.KHR_lights_punctual.lights[lightIndex].type).toBe("point");
    expect(after.scenes[0].nodes).toContain(index);
  });

  it("does not duplicate extensionsUsed when KHR_lights_punctual is already scaffolded (second call)", () => {
    const doc = fixtureDocument();
    const first = SceneEdit.addLightNode(doc, "Lamp1");
    const jsonAfterFirst = applyPatches(doc.json, first.command.patches);
    const docAfterFirst = { ...doc, json: jsonAfterFirst };
    const second = SceneEdit.addLightNode(docAfterFirst, "Lamp2");
    const after = applyPatches(jsonAfterFirst, second.command.patches) as { extensionsUsed: string[] };
    expect(after.extensionsUsed.filter((e) => e === "KHR_lights_punctual").length).toBe(1);
  });

  it("honors parentNodeIndex", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addLightNode(doc, "Lamp", { parentNodeIndex: 1 });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[1].children).toContain(index);
  });
});

describe("SceneEdit.addCameraNode (DOC-047)", () => {
  it("appends a perspective camera + a referencing node, as one command", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addCameraNode(doc, "Cam");
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; camera?: number }>;
      cameras: Array<{ type: string }>;
      scenes: Array<{ nodes: number[] }>;
    };
    const cameraIndex = after.nodes[index].camera!;
    expect(after.cameras[cameraIndex].type).toBe("perspective");
    expect(after.scenes[0].nodes).toContain(index);
  });

  it("honors parentNodeIndex", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addCameraNode(doc, "Cam", { parentNodeIndex: 0 });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[0].children).toContain(index);
  });
});

describe("SceneEdit.addAudioEmitterNode (DOC-047)", () => {
  it("builds a full audio+source+emitter chain plus a referencing node, as one command", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addAudioEmitterNode(doc, "Speaker");
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; extensions?: { KHR_audio_emitter?: { emitter: number } } }>;
      extensions: {
        KHR_audio_emitter: {
          audio: Array<{ bufferView: number; mimeType: string }>;
          sources: Array<{ audio: number }>;
          emitters: Array<{ type: string; sources: number[] }>;
        };
      };
      extensionsUsed: string[];
      buffers: Array<{ uri: string; byteLength: number }>;
      bufferViews: Array<{ buffer: number; byteLength: number }>;
      scenes: Array<{ nodes: number[] }>;
    };
    const emitterIndex = after.nodes[index].extensions!.KHR_audio_emitter!.emitter;
    const emitter = after.extensions.KHR_audio_emitter.emitters[emitterIndex];
    expect(emitter.type).toBe("positional");
    const sourceIndex = emitter.sources[0];
    const source = after.extensions.KHR_audio_emitter.sources[sourceIndex];
    const audio = after.extensions.KHR_audio_emitter.audio[source.audio];
    expect(audio.mimeType).toBe("audio/wav");
    expect(after.bufferViews[audio.bufferView]).toBeDefined();
    expect(after.buffers.length).toBeGreaterThan(0);
    // extensionsUsed already listed KHR_audio_emitter in the fixture — not duplicated.
    expect(after.extensionsUsed.filter((e) => e === "KHR_audio_emitter").length).toBe(1);
    expect(after.scenes[0].nodes).toContain(index);
  });

  it("is a single combined command: undoing it removes every appended element together", () => {
    const doc = fixtureDocument();
    const before = doc.json as { nodes: unknown[]; buffers?: unknown[] };
    const { command } = SceneEdit.addAudioEmitterNode(doc, "Speaker");
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
    expect((undone as { nodes: unknown[] }).nodes.length).toBe(before.nodes.length);
  });

  it("honors parentNodeIndex", () => {
    const doc = fixtureDocument();
    const { command, index } = SceneEdit.addAudioEmitterNode(doc, "Speaker", { parentNodeIndex: 1 });
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[1].children).toContain(index);
  });
});
