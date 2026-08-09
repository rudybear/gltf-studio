// SceneEdit command factories — v1 subset: property edits on existing scene
// elements (`setTransform`, `setName`, `setMaterialProperty`,
// `setAudioEmitterProperty`), PLUS (DOC-046) a minimal APPEND-ONLY subset of
// structural factories (`addNode`, `addMesh`, `addMaterial`, `addAccessor`,
// `addBufferView`, `addBuffer`) added ahead of schedule for
// `@gltf-studio/agent-mock`'s procedural asset-generation template — see
// docs/adr/0004-agentic-authoring-as-command-producer.md's "asset generation
// pulls scene-structural mutation earlier than the M8 plan assumed"
// consequence. These are deliberately narrow: they only ever APPEND a new
// element (plus, for `addNode`, appending its index into the current
// default scene's `nodes` array). Reparenting under an existing node,
// deletion, and the reference-fixup pass those would require are all still
// STUBBED (`removeNode`/`reparentNode` throw `SceneEditNotImplementedError`)
// and remain deferred to milestone M8 in full (structural scene editing
// needs its own reference-fixup pass over mesh/material/skin indices and
// node-hierarchy `children` arrays — out of scope here; the shared
// `fixupReferences` helper, fixup-references.ts, they will use already
// exists, built for `GraphEdit.removeNode`). Appending never needs that
// pass: nothing shifts when only adding to the end of an array.
import type { Command } from "./command.js";
import { combineCommandParts, makeCommandId } from "./command.js";
import { appendFragment, setPathFragment } from "./edit-fragments.js";
import { getIn } from "./json-pointer.js";
import { applyPatches } from "./patch.js";
import type { EditorDocument } from "./document.js";

export class SceneEditNotImplementedError extends Error {
  constructor(operation: string) {
    super(`SceneEdit.${operation} is not implemented in M1 — structural scene editing is deferred to milestone M8.`);
    this.name = "SceneEditNotImplementedError";
  }
}

export interface TransformFields {
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
}

export const SceneEdit = {
  /** Sets one or more of a node's `translation`/`rotation`/`scale`/`matrix` fields as a single command. */
  setTransform(document: EditorDocument, nodeIndex: number, fields: TransformFields): Command {
    const entries = Object.entries(fields) as Array<[keyof TransformFields, unknown]>;
    if (entries.length === 0) {
      throw new Error("setTransform requires at least one field.");
    }
    const fragments = entries.map(([field, value]) => setPathFragment(document.json, ["nodes", nodeIndex, field], value));
    // Keyed by node AND the exact set of fields this call touches (sorted,
    // so field order in the caller's `fields` object doesn't matter) —
    // NOT just the node — so e.g. a continuous drag/typing session on the
    // Inspector's Position row (repeated `{translation}`-only calls) still
    // coalesces into one history entry (DOC-015), but a translate-then-
    // rotate sequence on the SAME node (two separate gizmo drags, or a
    // Position edit followed by a Rotation edit) does NOT — those are two
    // separate completed edits and each earns its own undo step.
    const fieldKey = entries
      .map(([field]) => field)
      .sort()
      .join(",");
    return {
      id: makeCommandId("set-transform"),
      label: `Set transform on node ${nodeIndex}`,
      coalesceKey: `transform:${nodeIndex}:${fieldKey}`,
      patches: fragments.flatMap((f) => f.patches),
      inverse: fragments
        .slice()
        .reverse()
        .flatMap((f) => f.inverse)
    };
  },

  /** Sets `nodes[nodeIndex].name`. */
  setName(document: EditorDocument, nodeIndex: number, name: string): Command {
    const fragment = setPathFragment(document.json, ["nodes", nodeIndex, "name"], name);
    return {
      id: makeCommandId("set-name"),
      label: `Rename node ${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Sets an arbitrary property on `materials[materialIndex]` (e.g. `["pbrMetallicRoughness","baseColorFactor"]`). */
  setMaterialProperty(document: EditorDocument, materialIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["materials", materialIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-material-property"),
      label: `Set material ${materialIndex} ${propertyPath.join(".")}`,
      coalesceKey: `material-property:${materialIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Sets an arbitrary property on `extensions.KHR_audio_emitter.emitters[emitterIndex]`
   * (the root-level emitters registry the `KHR_audio_emitter` extension defines).
   */
  setAudioEmitterProperty(document: EditorDocument, emitterIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(
      document.json,
      ["extensions", "KHR_audio_emitter", "emitters", emitterIndex, ...propertyPath],
      value
    );
    return {
      id: makeCommandId("set-audio-emitter-property"),
      label: `Set audio emitter ${emitterIndex} ${propertyPath.join(".")}`,
      coalesceKey: `audio-emitter-property:${emitterIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-046: appends a `node` object to `json.nodes` and, when
   * `opts.addToScene` is true (the default), ALSO appends the new node's
   * index into the current default scene's `nodes` array
   * (`json.scenes[json.scene ?? 0].nodes`) — as one combined command
   * (`combineCommandParts`), so the whole thing is one undo step. Returns
   * the new node's index alongside the command (mirroring
   * `GraphEdit.ensureDeclaration`'s `{command, index}` shape) so a caller
   * can immediately reference it (e.g. wiring a new mesh into this node, or
   * targeting it from a fresh interactivity-graph pointer node) without a
   * second document read. Append-only: no reparenting under an existing
   * node, no removal — see this file's header comment.
   */
  addNode(document: EditorDocument, nodeDefinition: Record<string, unknown>, opts: { addToScene?: boolean } = {}): { command: Command; index: number } {
    const addToScene = opts.addToScene ?? true;
    const nodeFragment = appendFragment(document.json, ["nodes"], nodeDefinition);
    const label = `Add node${typeof nodeDefinition.name === "string" ? ` "${nodeDefinition.name}"` : ""}`;
    if (!addToScene) {
      return {
        index: nodeFragment.index,
        command: { id: makeCommandId("add-node"), label, patches: nodeFragment.patches, inverse: nodeFragment.inverse }
      };
    }
    const jsonAfterNode = applyPatches(document.json, nodeFragment.patches);
    const sceneIndex = (getIn(jsonAfterNode, ["scene"]) as number | undefined) ?? 0;
    const sceneFragment = appendFragment(jsonAfterNode, ["scenes", sceneIndex, "nodes"], nodeFragment.index);
    const combined = combineCommandParts([nodeFragment, sceneFragment]);
    return {
      index: nodeFragment.index,
      command: { id: makeCommandId("add-node"), label, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /** DOC-046: appends a `mesh` object (primitives/material references) to `json.meshes`. */
  addMesh(document: EditorDocument, mesh: Record<string, unknown>): { command: Command; index: number } {
    const fragment = appendFragment(document.json, ["meshes"], mesh);
    return {
      index: fragment.index,
      command: {
        id: makeCommandId("add-mesh"),
        label: `Add mesh${typeof mesh.name === "string" ? ` "${mesh.name}"` : ""}`,
        patches: fragment.patches,
        inverse: fragment.inverse
      }
    };
  },

  /** DOC-046: appends a `material` object to `json.materials`. */
  addMaterial(document: EditorDocument, material: Record<string, unknown>): { command: Command; index: number } {
    const fragment = appendFragment(document.json, ["materials"], material);
    return {
      index: fragment.index,
      command: {
        id: makeCommandId("add-material"),
        label: `Add material${typeof material.name === "string" ? ` "${material.name}"` : ""}`,
        patches: fragment.patches,
        inverse: fragment.inverse
      }
    };
  },

  /** DOC-046: appends an `accessor` object to `json.accessors`. */
  addAccessor(document: EditorDocument, accessor: Record<string, unknown>): { command: Command; index: number } {
    const fragment = appendFragment(document.json, ["accessors"], accessor);
    return {
      index: fragment.index,
      command: { id: makeCommandId("add-accessor"), label: "Add accessor", patches: fragment.patches, inverse: fragment.inverse }
    };
  },

  /** DOC-046: appends a `bufferView` object to `json.bufferViews`. */
  addBufferView(document: EditorDocument, bufferView: Record<string, unknown>): { command: Command; index: number } {
    const fragment = appendFragment(document.json, ["bufferViews"], bufferView);
    return {
      index: fragment.index,
      command: { id: makeCommandId("add-buffer-view"), label: "Add bufferView", patches: fragment.patches, inverse: fragment.inverse }
    };
  },

  /**
   * DOC-046: appends a `buffer` object to `json.buffers` — e.g. a
   * self-contained `data:` URI buffer for procedurally-generated geometry
   * (AG-014: asset generation lands as ordinary document patches, never a
   * side-channel binary-blob write).
   */
  addBuffer(document: EditorDocument, buffer: Record<string, unknown>): { command: Command; index: number } {
    const fragment = appendFragment(document.json, ["buffers"], buffer);
    return {
      index: fragment.index,
      command: { id: makeCommandId("add-buffer"), label: "Add buffer", patches: fragment.patches, inverse: fragment.inverse }
    };
  },

  /** STUB (M8): structural node removal + reference fixup. */
  removeNode(): never {
    throw new SceneEditNotImplementedError("removeNode");
  },

  /** STUB (M8): structural node reparenting. */
  reparentNode(): never {
    throw new SceneEditNotImplementedError("reparentNode");
  }
};
