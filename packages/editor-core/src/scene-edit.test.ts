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
  it("addNode/removeNode/reparentNode throw SceneEditNotImplementedError", () => {
    expect(() => SceneEdit.addNode()).toThrow(SceneEditNotImplementedError);
    expect(() => SceneEdit.removeNode()).toThrow(SceneEditNotImplementedError);
    expect(() => SceneEdit.reparentNode()).toThrow(SceneEditNotImplementedError);
    expect(() => SceneEdit.addNode()).toThrow(/M8/);
  });
});
