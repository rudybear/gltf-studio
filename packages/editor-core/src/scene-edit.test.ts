import { describe, expect, it } from "vitest";
import { applyPatches } from "./patch.js";
import { deepEqualJson } from "./json-pointer.js";
import { CycleReparentError, SceneEdit } from "./scene-edit.js";
import { fixtureDocument, fixtureGltfJson } from "./test-fixtures.js";
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

// DOC-062: the source-side sibling of setAudioEmitterProperty — first used
// by @gltf-studio/audio-canvas to persist a synthetic audio-buffer-source
// terminal node's canvas position (extras.gltfi) on the underlying
// KHR_audio_emitter source entry, since that node is not a graph.nodes[]
// entry AudioGraphEdit.setNodePosition (DOC-058) can address.
describe("SceneEdit.setAudioSourceProperty (DOC-062)", () => {
  function sourceFixtureDocument() {
    return fixtureDocument({
      ...fixtureGltfJson(),
      extensions: {
        ...(fixtureGltfJson().extensions as object),
        KHR_audio_emitter: { sources: [{ audio: 0, gain: 1 }], emitters: [{ type: "positional", gain: 1 }] }
      }
    });
  }

  it("sets a source property and round-trips", () => {
    const doc = sourceFixtureDocument();
    const command = SceneEdit.setAudioSourceProperty(doc, 0, ["gain"], 0.75);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_audio_emitter: { sources: Array<{ gain: number }> } };
    };
    expect(after.extensions.KHR_audio_emitter.sources[0].gain).toBe(0.75);
  });

  it("sets extras.gltfi.{x,y} (the canvas-position use) and round-trips", () => {
    const doc = sourceFixtureDocument();
    const command = SceneEdit.setAudioSourceProperty(doc, 0, ["extras", "gltfi"], { x: 12, y: 34 });
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_audio_emitter: { sources: Array<{ extras?: { gltfi?: { x: number; y: number } } }> } };
    };
    expect(after.extensions.KHR_audio_emitter.sources[0].extras).toEqual({ gltfi: { x: 12, y: 34 } });
  });

  it("coalesces per source index and property path", () => {
    const doc = sourceFixtureDocument();
    const a = SceneEdit.setAudioSourceProperty(doc, 0, ["extras", "gltfi"], { x: 1, y: 1 });
    const b = SceneEdit.setAudioSourceProperty(doc, 0, ["extras", "gltfi"], { x: 2, y: 2 });
    const c = SceneEdit.setAudioSourceProperty(doc, 0, ["gain"], 0.5);
    expect(a.coalesceKey).toBe(b.coalesceKey);
    expect(a.coalesceKey).not.toBe(c.coalesceKey);
  });
});

// Richer inspector (specs/ux-inspector.md UX-417): SceneEdit.setLightProperty
// against the root extensions.KHR_lights_punctual.lights[] registry.
describe("SceneEdit.setLightProperty (DOC-060)", () => {
  function lightFixtureDocument() {
    return fixtureDocument({
      ...fixtureGltfJson(),
      extensionsUsed: ["KHR_lights_punctual"],
      extensions: { KHR_lights_punctual: { lights: [{ type: "spot", intensity: 500, spot: { innerConeAngle: 0, outerConeAngle: 0.7 } }] } }
    });
  }

  it("sets a scalar light property and round-trips", () => {
    const doc = lightFixtureDocument();
    const command = SceneEdit.setLightProperty(doc, 0, ["intensity"], 900);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_lights_punctual: { lights: Array<{ intensity: number }> } };
    };
    expect(after.extensions.KHR_lights_punctual.lights[0].intensity).toBe(900);
  });

  it("sets a nested spot cone-angle property and round-trips", () => {
    const doc = lightFixtureDocument();
    const command = SceneEdit.setLightProperty(doc, 0, ["spot", "outerConeAngle"], 0.9);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_lights_punctual: { lights: Array<{ spot: { outerConeAngle: number } }> } };
    };
    expect(after.extensions.KHR_lights_punctual.lights[0].spot.outerConeAngle).toBe(0.9);
  });
});

// Richer inspector (specs/ux-inspector.md UX-418): SceneEdit.setCameraProperty
// against core glTF's cameras[] array.
describe("SceneEdit.setCameraProperty (DOC-060)", () => {
  function cameraFixtureDocument() {
    return fixtureDocument({
      ...fixtureGltfJson(),
      cameras: [{ type: "perspective", perspective: { yfov: 0.8, znear: 0.1 } }]
    });
  }

  it("sets a perspective property and round-trips", () => {
    const doc = cameraFixtureDocument();
    const command = SceneEdit.setCameraProperty(doc, 0, ["perspective", "yfov"], 1.1);
    const after = expectRoundTrip(doc.json, command) as {
      cameras: Array<{ perspective: { yfov: number } }>;
    };
    expect(after.cameras[0].perspective.yfov).toBe(1.1);
  });

  it("adds a previously-absent property (znear present, zfar absent) and round-trips", () => {
    const doc = cameraFixtureDocument();
    const command = SceneEdit.setCameraProperty(doc, 0, ["perspective", "zfar"], 100);
    const after = expectRoundTrip(doc.json, command) as {
      cameras: Array<{ perspective: { zfar: number } }>;
    };
    expect(after.cameras[0].perspective.zfar).toBe(100);
  });
});

// Richer inspector (specs/ux-inspector.md UX-416): texture-slot clear + KHR_texture_transform writes.
describe("SceneEdit.clearMaterialTexture (DOC-060)", () => {
  function texturedFixtureDocument() {
    return fixtureDocument({
      ...fixtureGltfJson(),
      materials: [
        {
          name: "Mat0",
          pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }
        }
      ],
      textures: [{ source: 0 }],
      images: [{ uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScY42YAAAAASUVORK5CYII=" }]
    });
  }

  it("removes the whole texture-info object and round-trips", () => {
    const doc = texturedFixtureDocument();
    const command = SceneEdit.clearMaterialTexture(doc, 0, ["pbrMetallicRoughness", "baseColorTexture"]);
    const after = expectRoundTrip(doc.json, command) as {
      materials: Array<{ pbrMetallicRoughness: { baseColorTexture?: unknown } }>;
    };
    expect(after.materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();
  });

  it("throws when the slot is already unset", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.clearMaterialTexture(doc, 0, ["normalTexture"])).toThrow();
  });
});

describe("SceneEdit.setMaterialTextureTransform (DOC-060)", () => {
  function texturedFixtureDocument() {
    return fixtureDocument({
      ...fixtureGltfJson(),
      materials: [
        {
          name: "Mat0",
          pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } }
        }
      ],
      textures: [{ source: 0 }],
      images: [{ uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScY42YAAAAASUVORK5CYII=" }]
    });
  }

  it("sets an offset, scaffolds extensionsUsed, and round-trips", () => {
    const doc = texturedFixtureDocument();
    expect((doc.json as { extensionsUsed?: string[] }).extensionsUsed ?? []).not.toContain("KHR_texture_transform");
    const command = SceneEdit.setMaterialTextureTransform(doc, 0, ["pbrMetallicRoughness", "baseColorTexture"], "offset", [0.25, 0.5]);
    const after = expectRoundTrip(doc.json, command) as {
      extensionsUsed: string[];
      materials: Array<{
        pbrMetallicRoughness: { baseColorTexture: { extensions: { KHR_texture_transform: { offset: number[] } } } };
      }>;
    };
    expect(after.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.offset).toEqual([0.25, 0.5]);
    expect(after.extensionsUsed).toContain("KHR_texture_transform");
  });

  it("a second write does not duplicate the extensionsUsed entry", () => {
    const doc = texturedFixtureDocument();
    const first = SceneEdit.setMaterialTextureTransform(doc, 0, ["pbrMetallicRoughness", "baseColorTexture"], "offset", [0.25, 0.5]);
    const afterFirst = applyPatches(doc.json, first.patches);
    const docAfterFirst = { ...doc, json: afterFirst };
    const second = SceneEdit.setMaterialTextureTransform(docAfterFirst, 0, ["pbrMetallicRoughness", "baseColorTexture"], "scale", [2, 2]);
    const after = expectRoundTrip(docAfterFirst.json, second) as { extensionsUsed: string[] };
    expect(after.extensionsUsed.filter((e) => e === "KHR_texture_transform")).toHaveLength(1);
  });
});

// DOC-052 (M8 part 2): SceneEdit.reparentNode — moves an EXISTING node (and
// its whole subtree, implicitly, via its unchanged `children`) between
// membership arrays, with NO index-shift reference fixup needed (nodeIndex
// itself never changes) and a typed cycle rejection.
describe("SceneEdit.reparentNode (DOC-052)", () => {
  it("moves a scene-root node under another node's children, removing it from the scene root", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ name: "Parent" }, { name: "Mover" }]
    });
    const command = SceneEdit.reparentNode(doc, 1, 0);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes[0].children).toEqual([1]);
    expect(after.scenes[0].nodes).toEqual([0]); // Mover no longer a scene root.
  });

  it("moves a child node to scene root when newParentIndex is null", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Parent", children: [1] }, { name: "Child" }]
    });
    const command = SceneEdit.reparentNode(doc, 1, null);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes[0].children).toBeUndefined(); // Parent's only child left -> property removed, not [].
    expect(after.scenes[0].nodes).toEqual([0, 1]);
  });

  it("moves a node from one parent to another (both non-root), preserving each parent's OTHER children", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: "OldParent", children: [2, 3] },
        { name: "NewParent" },
        { name: "Mover" }, // 2
        { name: "Sibling" } // 3
      ]
    });
    const command = SceneEdit.reparentNode(doc, 2, 1);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[0].children).toEqual([3]); // OldParent keeps Sibling, loses Mover.
    expect(after.nodes[1].children).toEqual([2]); // NewParent gains Mover.
  });

  it("lands at a specific insertIndex among the new parent's existing children rather than always appending last", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 3] }],
      nodes: [{ name: "Parent", children: [1, 2] }, { name: "A" }, { name: "B" }, { name: "Mover" }]
    });
    const command = SceneEdit.reparentNode(doc, 3, 0, 1);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[0].children).toEqual([1, 3, 2]); // inserted BETWEEN A and B, not appended after B.
  });

  it("reparenting under its own current parent with no insertIndex moves it to be the LAST child (not an error, not a no-op)", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Parent", children: [1, 2] }, { name: "A" }, { name: "B" }]
    });
    const command = SceneEdit.reparentNode(doc, 1, 0);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[0].children).toEqual([2, 1]); // A moved to the end, past B.
  });

  it("rejects reparenting a node under itself with a typed CycleReparentError", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.reparentNode(doc, 0, 0)).toThrow(CycleReparentError);
  });

  it("rejects reparenting a node under its own descendant with a typed CycleReparentError", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Root", children: [1] }, { name: "Mid", children: [2] }, { name: "Leaf" }]
    });
    expect(() => SceneEdit.reparentNode(doc, 0, 2)).toThrow(CycleReparentError);
    expect(() => SceneEdit.reparentNode(doc, 0, 1)).toThrow(CycleReparentError);
  });

  it("throws a plain Error (not CycleReparentError) for an out-of-range nodeIndex or newParentIndex", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.reparentNode(doc, 99, 0)).toThrow();
    expect(() => SceneEdit.reparentNode(doc, 0, 99)).toThrow();
    try {
      SceneEdit.reparentNode(doc, 0, 99);
    } catch (err) {
      expect(err).not.toBeInstanceOf(CycleReparentError);
    }
  });

  it("moving a node's subtree carries its descendants along implicitly (children array itself is untouched) — no reference anywhere needs fixing up since no node index ever changes", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: "OldParent", children: [2] },
        { name: "NewParent" },
        { name: "Mover", children: [3] }, // 2
        { name: "MoverChild" } // 3
      ],
      extensionsUsed: ["KHR_interactivity"],
      extensions: {
        KHR_interactivity: {
          graph: 0,
          graphs: [
            {
              types: [],
              declarations: [{ op: "event/onSelect" }],
              nodes: [{ declaration: 0, configuration: { nodeIndex: { value: [3] } } }]
            }
          ]
        }
      }
    });
    const command = SceneEdit.reparentNode(doc, 2, 1);
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; children?: number[] }>;
      extensions: { KHR_interactivity: { graphs: Array<{ nodes: Array<{ configuration: { nodeIndex: { value: number[] } } }> }> } };
    };
    expect(after.nodes[1].children).toEqual([2]); // Mover now under NewParent.
    expect(after.nodes[2].children).toEqual([3]); // Mover's own children untouched.
    expect(after.nodes[3].name).toBe("MoverChild"); // MoverChild's own index (3) never changed.
    // The onSelect handler's literal configuration.nodeIndex (3) is completely untouched -- reparenting shifts no index at all.
    expect(after.extensions.KHR_interactivity.graphs[0].nodes[0].configuration.nodeIndex.value[0]).toBe(3);
  });

  it("undo restores the exact pre-reparent document", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ name: "Parent" }, { name: "Mover" }]
    });
    const command = SceneEdit.reparentNode(doc, 1, 0);
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
  });

  function expectCloseVec(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  }

  // DOC-052's WORLD-transform-preservation default (resolved policy: the
  // scene tree's "move under a different node" gesture must not silently
  // relocate the object in the viewport). These scenarios hand-derive the
  // expected local TRS by solving `newLocal = inverse(newParentWorld) *
  // oldWorld` the same way `reparentNode` itself does (`mat-utils.ts`), so a
  // regression in either the production code OR this test's own math would
  // show up as a real numeric mismatch, not a tautology.
  describe("world-transform preservation (default policy)", () => {
    it("recomputes local translation+scale so the WORLD transform is numerically unchanged when moving under a scaled+translated new parent", () => {
      const doc = fixtureDocument({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { name: "OldParent", children: [2] },
          { name: "NewParent", translation: [10, 0, 0], scale: [2, 2, 2] },
          { name: "Mover", translation: [1, 0, 0] } // 2: world position [1,0,0] under identity OldParent
        ]
      });
      const command = SceneEdit.reparentNode(doc, 2, 1);
      const after = expectRoundTrip(doc.json, command) as {
        nodes: Array<{ translation?: number[]; rotation?: number[]; scale?: number[] }>;
      };
      const mover = after.nodes[2];
      // NewParent's world matrix maps local (x,y,z) -> (10+2x, 2y, 2z); solving
      // for the local translation that reproduces world (1,0,0): (1-10)/2 = -4.5.
      expectCloseVec(mover.translation!, [-4.5, 0, 0]);
      // Mover's own world scale must stay 1 despite NewParent's 2x scale.
      expectCloseVec(mover.scale!, [0.5, 0.5, 0.5]);
      expectCloseVec(mover.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1]);
    });

    it("recomputes the local `matrix` field (instead of TRS) when the node already authored its transform that way", () => {
      const doc = fixtureDocument({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { name: "OldParent", children: [2] },
          { name: "NewParent", translation: [5, 0, 0] },
          // Column-major identity matrix with translation [2,0,0] baked in.
          { name: "Mover", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] }
        ]
      });
      const command = SceneEdit.reparentNode(doc, 2, 1);
      const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ matrix?: number[]; translation?: number[] }> };
      const mover = after.nodes[2];
      expect(mover.matrix).toBeDefined();
      expect(mover.translation).toBeUndefined(); // stayed a `matrix` node, not converted to TRS.
      // World position was [2,0,0]; NewParent sits at world [5,0,0] with no
      // scale/rotation -> new local translation is 2 - 5 = -3.
      expectCloseVec([mover.matrix![12], mover.matrix![13], mover.matrix![14]], [-3, 0, 0]);
    });

    it("reparenting to root (newParentIndex null) is world-position-preserving too — new local translation equals the old world position", () => {
      const doc = fixtureDocument({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: "Parent", translation: [3, 4, 5], children: [1] }, { name: "Child", translation: [1, 1, 1] }]
      });
      const command = SceneEdit.reparentNode(doc, 1, null);
      const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ translation?: number[] }> };
      expectCloseVec(after.nodes[1].translation!, [4, 5, 6]); // Parent's [3,4,5] + Child's own [1,1,1]
    });

    it("opts.keepLocal: true opts OUT of world-transform preservation — the local translation carries over completely unchanged", () => {
      const doc = fixtureDocument({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { name: "OldParent", children: [2] },
          { name: "NewParent", translation: [10, 0, 0], scale: [2, 2, 2] },
          { name: "Mover", translation: [1, 0, 0] }
        ]
      });
      const command = SceneEdit.reparentNode(doc, 2, 1, undefined, { keepLocal: true });
      const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ translation?: number[] }> };
      expectCloseVec(after.nodes[2].translation!, [1, 0, 0]); // unchanged local -- world position DOES change as a result.
    });
  });
});

// DOC-053 (M8 part 2): SceneEdit.duplicateNode — deep-copies a node+subtree
// as brand-new, appended nodes, sharing (never copying) every non-node
// resource reference (mesh/material/accessor/etc), never auto-wiring the
// copy into any interactivity graph.
describe("SceneEdit.duplicateNode (DOC-053)", () => {
  it("duplicates a leaf node as a new node appended to json.nodes, named with a ' copy' suffix, sharing its mesh reference", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Cube", mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }]
    });
    const { command, index } = SceneEdit.duplicateNode(doc, 0);
    expect(index).toBe(1);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string; mesh?: number }>; meshes: unknown[] };
    expect(after.nodes).toHaveLength(2);
    expect(after.nodes[1].name).toBe("Cube copy");
    expect(after.nodes[1].mesh).toBe(0); // shares the SAME mesh index -- no geometry copy.
    expect(after.meshes).toHaveLength(1); // the meshes registry itself is untouched.
  });

  it("is placed as a sibling immediately AFTER the original, in the same membership array", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ name: "A" }, { name: "B" }, { name: "C" }]
    });
    const { command, index } = SceneEdit.duplicateNode(doc, 0);
    const after = expectRoundTrip(doc.json, command) as { scenes: Array<{ nodes: number[] }> };
    expect(after.scenes[0].nodes).toEqual([0, index, 1, 2]); // right after A, before B and C.
  });

  it("duplicates a node under a parent as a sibling right after it, within that parent's children", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Parent", children: [1, 2] }, { name: "A" }, { name: "B" }]
    });
    const { command, index } = SceneEdit.duplicateNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ children?: number[] }> };
    expect(after.nodes[0].children).toEqual([1, index, 2]);
  });

  it("deep-copies an entire subtree as new nodes, remapping the copy's OWN internal children to its own new indices, and applies the ' copy' suffix to every duplicated node not just the root", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Root", children: [1] }, { name: "Mid", children: [2] }, { name: "Leaf" }]
    });
    const { command, index } = SceneEdit.duplicateNode(doc, 0);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string; children?: number[] }> };
    expect(after.nodes).toHaveLength(6); // 3 original + 3 duplicated.
    expect(index).toBe(3); // Root's copy.
    expect(after.nodes[3]).toMatchObject({ name: "Root copy", children: [4] });
    expect(after.nodes[4]).toMatchObject({ name: "Mid copy", children: [5] });
    expect(after.nodes[5]).toMatchObject({ name: "Leaf copy" });
    expect(after.nodes[5].children).toBeUndefined();
    // The ORIGINAL subtree's own children are completely untouched.
    expect(after.nodes[0]).toMatchObject({ name: "Root", children: [1] });
    expect(after.nodes[1]).toMatchObject({ name: "Mid", children: [2] });
  });

  it("increases the node count by exactly the subtree's size (DOC-053 property, single-scenario check)", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Root", children: [1, 2] }, { name: "A" }, { name: "B" }]
    });
    const before = doc.json as { nodes: unknown[] };
    const { command } = SceneEdit.duplicateNode(doc, 0);
    const after = applyPatches(doc.json, command.patches) as { nodes: unknown[] };
    expect(after.nodes.length).toBe(before.nodes.length + 3); // Root + A + B, the whole subtree.
  });

  it("does NOT auto-wire the duplicate into an existing interactivity graph handler that addresses the original node", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Pad" }],
      extensionsUsed: ["KHR_interactivity"],
      extensions: {
        KHR_interactivity: {
          graph: 0,
          graphs: [
            {
              types: [],
              declarations: [{ op: "event/onSelect" }],
              nodes: [{ declaration: 0, configuration: { nodeIndex: { value: [0] } } }]
            }
          ]
        }
      }
    });
    const { command, index } = SceneEdit.duplicateNode(doc, 0);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_interactivity: { graphs: Array<{ nodes: Array<{ configuration: { nodeIndex: { value: number[] } } }> }> } };
    };
    // Still exactly one onSelect handler, still targeting the ORIGINAL node (0) -- not the new copy.
    expect(after.extensions.KHR_interactivity.graphs[0].nodes).toHaveLength(1);
    expect(after.extensions.KHR_interactivity.graphs[0].nodes[0].configuration.nodeIndex.value[0]).toBe(0);
    expect(after.extensions.KHR_interactivity.graphs[0].nodes[0].configuration.nodeIndex.value[0]).not.toBe(index);
  });

  it("throws for an out-of-range node index", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.duplicateNode(doc, 99)).toThrow();
  });

  it("is a single combined command: undoing it removes every duplicated node together", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Root", children: [1] }, { name: "Child" }]
    });
    const before = doc.json as { nodes: unknown[] };
    const { command } = SceneEdit.duplicateNode(doc, 0);
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
    expect((undone as { nodes: unknown[] }).nodes.length).toBe(before.nodes.length);
  });
});

// DOC-048 (M8 part 1): SceneEdit.removeNode — subtree deletion + full
// reference fixup. Custom fixtures per test (not the shared `fixtureDocument`
// default) so each scenario's node graph/references are easy to read inline.
describe("SceneEdit.removeNode (DOC-048)", () => {
  it("removes a leaf node with no children or references and round-trips", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ name: "Alpha" }, { name: "Beta" }]
    });
    const { command, parentIndex } = SceneEdit.removeNode(doc, 1);
    expect(parentIndex).toBeNull(); // Beta was a scene-root node, not parented under anything.
    expect(command.label).toBe("Delete node");
    const after = expectRoundTrip(doc.json, command) as { nodes: unknown[]; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes).toHaveLength(1);
    expect(after.nodes[0]).toMatchObject({ name: "Alpha" });
    expect(after.scenes[0].nodes).toEqual([0]);
  });

  it("throws for an out-of-range node index", () => {
    const doc = fixtureDocument();
    expect(() => SceneEdit.removeNode(doc, 99)).toThrow();
  });

  it("deletes a node's ENTIRE descendant subtree as one command, labeled with the subtree count", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 3] }],
      nodes: [
        { name: "Root", children: [1] }, // 0: removed (the target)
        { name: "Mid", children: [2] }, // 1: removed (descendant)
        { name: "Leaf" }, // 2: removed (descendant)
        { name: "Untouched" } // 3: survives, but its scene-root index shifts down
      ]
    });
    const { command, parentIndex } = SceneEdit.removeNode(doc, 0);
    expect(parentIndex).toBeNull(); // Root had no parent.
    expect(command.label).toBe("Delete 3 nodes");
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string }>; scenes: Array<{ nodes: number[] }> };
    expect(after.nodes).toHaveLength(1);
    expect(after.nodes[0].name).toBe("Untouched");
    expect(after.scenes[0].nodes).toEqual([0]); // Untouched's index shifted 3 -> 0.
  });

  it("removing a child returns the PARENT's post-removal index, for scene-tree selection-after-delete (specs/ux-scene-tree.md UX-214)", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: "Root", children: [1, 2] }, // 0
        { name: "ChildA" }, // 1: removed
        { name: "ChildB" } // 2: survives, shifts to index 1
      ]
    });
    const { command, parentIndex } = SceneEdit.removeNode(doc, 1);
    expect(parentIndex).toBe(0); // Root's own index (0) is below the removed index (1) -> unshifted.
    const after = applyPatches(doc.json, command.patches) as { nodes: Array<{ name: string; children?: number[] }> };
    expect(after.nodes[0].children).toEqual([1]); // ChildB, shifted from 2 -> 1.
    expect(after.nodes[0].name).toBe("Root");
  });

  it("a deleted subtree containing an index BELOW an ancestor outside the subtree shifts the returned parentIndex down too", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [1] }],
      nodes: [
        { name: "GrandchildOutOfOrder" }, // 0: Target's child — deliberately a SMALLER index than its own ancestors
        { name: "Parent", children: [2] }, // 1: survives, outside the deleted subtree
        { name: "Target", children: [0] } // 2: the delete target; its subtree is {2, 0}
      ]
    });
    const { command, parentIndex } = SceneEdit.removeNode(doc, 2);
    // Parent's original index (1) minus the one deleted subtree member below it (index 0) -> 0.
    expect(parentIndex).toBe(0);
    const after = expectRoundTrip(doc.json, command) as { nodes: Array<{ name: string; children?: number[] }> };
    expect(after.nodes).toHaveLength(1);
    expect(after.nodes[0]).toMatchObject({ name: "Parent" });
    expect(after.nodes[0].children).toBeUndefined(); // its only child (Target) was the deleted subtree root.
  });

  /** @spec DOC-049 */
  it("children/scenes.nodes fixup: drops the removed index from wherever it was parented, shifts every OTHER reference above it down by one", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 4] }],
      nodes: [
        { name: "A" }, // 0
        { name: "Parent", children: [2, 3] }, // 1
        { name: "B" }, // 2: removed
        { name: "C" }, // 3: shifts to 2
        { name: "D" } // 4: shifts to 3
      ]
    });
    const { command } = SceneEdit.removeNode(doc, 2);
    const after = expectRoundTrip(doc.json, command) as {
      nodes: Array<{ name: string; children?: number[] }>;
      scenes: Array<{ nodes: number[] }>;
    };
    expect(after.nodes).toHaveLength(4);
    expect(after.nodes[1]).toMatchObject({ name: "Parent", children: [2] }); // C, shifted 3 -> 2
    expect(after.nodes[2].name).toBe("C");
    expect(after.nodes[3].name).toBe("D");
    expect(after.scenes[0].nodes).toEqual([0, 1, 3]); // D's scene-root entry, shifted 4 -> 3
  });

  /** @spec DOC-049 */
  it("KHR_interactivity pointer/set|get|interpolate literal pointer strings: shifts a literal above the removed index, leaves a dangling literal (pointing at the removed node) untouched — and never touches a graph node's OWN {node} wiring (a different index space)", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ name: "A" }, { name: "ToRemove" }, { name: "C" }],
      extensionsUsed: ["KHR_interactivity"],
      extensions: {
        KHR_interactivity: {
          graph: 0,
          graphs: [
            {
              types: [],
              declarations: [{ op: "pointer/set" }, { op: "math/add" }],
              nodes: [
                {
                  declaration: 0,
                  values: {
                    // Graph-internal wiring to ANOTHER GRAPH NODE (index 1 in
                    // the GRAPH's own `nodes` array, a completely separate
                    // index space from the SCENE node being removed below) —
                    // must be entirely untouched by a scene-node removal.
                    fromOtherGraphNode: { node: 1, socket: "out" },
                    scenePointerLiteral: { type: 0, value: ["/nodes/1/translation"] }, // literal pointing at the removed scene node -> left dangling
                    scenePointerAbove: { type: 0, value: ["/nodes/2/translation"] } // literal pointing above -> shifts to 1
                  }
                },
                { declaration: 1 } // graph node index 1 — the target of fromOtherGraphNode above
              ]
            }
          ]
        }
      }
    });
    const { command } = SceneEdit.removeNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: {
        KHR_interactivity: {
          graphs: Array<{
            nodes: Array<{ values?: { fromOtherGraphNode: { node: number }; scenePointerLiteral: { value: string[] }; scenePointerAbove: { value: string[] } } }>;
          }>;
        };
      };
    };
    const graphNode = after.extensions.KHR_interactivity.graphs[0].nodes[0];
    expect(graphNode.values!.fromOtherGraphNode.node).toBe(1); // untouched — a different (graph-node) index space entirely
    expect(graphNode.values!.scenePointerLiteral.value[0]).toBe("/nodes/1/translation"); // left dangling (policy: not repaired)
    expect(graphNode.values!.scenePointerAbove.value[0]).toBe("/nodes/1/translation"); // shifted 2 -> 1
    // The graph itself still has both its own nodes — removing a SCENE node never touches graph.nodes' own length.
    expect(after.extensions.KHR_interactivity.graphs[0].nodes).toHaveLength(2);
  });

  /** @spec DOC-049 */
  it("an event/onSelect handler's literal configuration.nodeIndex: shifts when above the removed index, stays dangling when equal, never touches the -1 sentinel", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ name: "A" }, { name: "ToRemove" }, { name: "C" }],
      extensionsUsed: ["KHR_interactivity"],
      extensions: {
        KHR_interactivity: {
          graph: 0,
          graphs: [
            {
              types: [],
              declarations: [{ op: "event/onSelect" }, { op: "event/onHoverOut" }],
              nodes: [
                { declaration: 0, configuration: { nodeIndex: { value: [1] } } }, // dangling: pointed at the removed node
                { declaration: 0, configuration: { nodeIndex: { value: [2] } } }, // shifts 2 -> 1
                { declaration: 1, configuration: { nodeIndex: { value: [-1] } } } // sentinel: never touched
              ]
            }
          ]
        }
      }
    });
    const { command } = SceneEdit.removeNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as {
      extensions: { KHR_interactivity: { graphs: Array<{ nodes: Array<{ configuration: { nodeIndex: { value: number[] } } }> }> } };
    };
    const nodes = after.extensions.KHR_interactivity.graphs[0].nodes;
    expect(nodes[0].configuration.nodeIndex.value[0]).toBe(1); // dangling, left as-is
    expect(nodes[1].configuration.nodeIndex.value[0]).toBe(1); // shifted 2 -> 1
    expect(nodes[2].configuration.nodeIndex.value[0]).toBe(-1); // sentinel, untouched
  });

  /** @spec DOC-050 */
  it("a node with a KHR_audio_emitter attachment is removed cleanly — the emitters registry is untouched/orphaned, not garbage-collected", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ name: "A" }, { name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } }],
      extensionsUsed: ["KHR_audio_emitter"],
      extensions: { KHR_audio_emitter: { emitters: [{ type: "positional", gain: 1 }] } }
    });
    const { command } = SceneEdit.removeNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as {
      nodes: unknown[];
      extensions: { KHR_audio_emitter: { emitters: unknown[] } };
    };
    expect(after.nodes).toHaveLength(1);
    // The now-unreferenced emitter registry entry is left in place (orphaned resources stay, DOC-048).
    expect(after.extensions.KHR_audio_emitter.emitters).toHaveLength(1);
  });

  /** @spec DOC-049 */
  it("animation channels targeting the removed node are DROPPED; channels targeting a higher node shift down; channels targeting a lower node are untouched (DOC-048 policy)", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ name: "A" }, { name: "ToRemove" }, { name: "C" }],
      animations: [
        {
          name: "Clip",
          samplers: [{ input: 0, output: 1 }, { input: 0, output: 1 }],
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" } }, // untouched: below the removed index
            { sampler: 1, target: { node: 1, path: "rotation" } }, // dropped: targets the removed node exactly
            { sampler: 0, target: { node: 2, path: "scale" } } // shifted: 2 -> 1
          ]
        }
      ]
    });
    const { command } = SceneEdit.removeNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as {
      animations: Array<{ channels: Array<{ sampler: number; target: { node: number; path: string } }> }>;
    };
    const channels = after.animations[0].channels;
    expect(channels).toHaveLength(2);
    expect(channels.find((c) => c.target.path === "translation")?.target).toEqual({ node: 0, path: "translation" });
    expect(channels.some((c) => c.target.path === "rotation")).toBe(false); // dropped
    expect(channels.find((c) => c.target.path === "scale")?.target).toEqual({ node: 1, path: "scale" });
  });

  /** @spec DOC-049 */
  it("skins (defensive — this app never authors/renders them, but must not corrupt an IMPORTED asset's skin data): joints drop-or-shift, skeleton drop-on-match-or-shift", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2, 3] }],
      nodes: [{ name: "A" }, { name: "ToRemove" }, { name: "Joint" }, { name: "SkeletonRoot" }],
      skins: [{ joints: [1, 2], skeleton: 1 }, { joints: [2, 3], skeleton: 3 }]
    });
    const { command } = SceneEdit.removeNode(doc, 1);
    const after = expectRoundTrip(doc.json, command) as {
      skins: Array<{ joints: number[]; skeleton?: number }>;
    };
    expect(after.skins[0].joints).toEqual([1]); // 1 dropped, 2 shifted -> 1
    expect(after.skins[0].skeleton).toBeUndefined(); // equaled the removed index -> property removed
    expect(after.skins[1].joints).toEqual([1, 2]); // 2 -> 1, 3 -> 2
    expect(after.skins[1].skeleton).toBe(2); // 3 -> 2
  });

  it("undo restores the exact pre-removal document, including a multi-node subtree deletion", () => {
    const doc = fixtureDocument({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Root", children: [1, 2] }, { name: "ChildA" }, { name: "ChildB" }]
    });
    const { command } = SceneEdit.removeNode(doc, 0);
    const after = applyPatches(doc.json, command.patches);
    const undone = applyPatches(after, command.inverse);
    expect(deepEqualJson(undone, doc.json)).toBe(true);
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
