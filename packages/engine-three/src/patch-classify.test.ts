import { describe, expect, it } from "vitest";
import { classifyPatchBatch, isStructuralPatch } from "./patch-classify.js";
import type { JsonPatchOp } from "@gltf-studio/engine-api";

const REFERENCE_JSON = {
  nodes: [{ name: "A", translation: [0, 0, 0] }, { name: "B" }],
  extensions: { KHR_audio_emitter: { emitters: [{ gain: 1, distanceModel: "inverse" }] } }
};

describe("isStructuralPatch", () => {
  it("RH-011: add/remove/move on an array element is structural", () => {
    expect(isStructuralPatch({ op: "add", path: "/nodes/2", value: {} }, REFERENCE_JSON)).toBe(true);
    expect(isStructuralPatch({ op: "remove", path: "/nodes/0" }, REFERENCE_JSON)).toBe(true);
  });

  it("RH-012: a replace of a whole structural root is structural", () => {
    expect(isStructuralPatch({ op: "replace", path: "/nodes", value: [] }, REFERENCE_JSON)).toBe(true);
  });

  it("RH-013: a replace of a leaf field, with a supported value, is non-structural", () => {
    expect(isStructuralPatch({ op: "replace", path: "/nodes/0/translation", value: [1, 2, 3] }, REFERENCE_JSON)).toBe(false);
    expect(isStructuralPatch({ op: "replace", path: "/extensions/KHR_audio_emitter/emitters/0/gain", value: 0.5 }, REFERENCE_JSON)).toBe(
      false
    );
  });

  it("RH-026: a replace/add whose value has no live-pointer representation (e.g. a string enum) is structural, even outside the RH-012 root list", () => {
    const patch: JsonPatchOp = { op: "replace", path: "/extensions/KHR_audio_emitter/emitters/0/distanceModel", value: "linear" };
    expect(isStructuralPatch(patch, REFERENCE_JSON)).toBe(true);
  });

  it("RH-026 does not apply to remove/move (no value to check) — falls through to the existing rules", () => {
    expect(isStructuralPatch({ op: "remove", path: "/extensions/KHR_audio_emitter/emitters/0/distanceModel" }, REFERENCE_JSON)).toBe(
      false
    );
  });
});

describe("classifyPatchBatch (RH-014)", () => {
  it("returns needs-reload if ANY patch in the batch is structural, applied only if none are", () => {
    const allNonStructural: JsonPatchOp[] = [{ op: "replace", path: "/nodes/0/translation", value: [1, 0, 0] }];
    expect(classifyPatchBatch(allNonStructural, REFERENCE_JSON)).toBe("applied");

    const oneStructural: JsonPatchOp[] = [
      { op: "replace", path: "/nodes/0/translation", value: [1, 0, 0] },
      { op: "replace", path: "/extensions/KHR_audio_emitter/emitters/0/distanceModel", value: "linear" }
    ];
    expect(classifyPatchBatch(oneStructural, REFERENCE_JSON)).toBe("needs-reload");
  });
});
