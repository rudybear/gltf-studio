// SceneEdit command factories — v1 subset: property edits on existing scene
// elements (`setTransform`, `setName`, `setMaterialProperty`,
// `setAudioEmitterProperty`). Structural edits (`addNode`, `removeNode`,
// `reparentNode`) are STUBBED: they throw `SceneEditNotImplementedError`
// rather than silently doing nothing, deferred to milestone M8 (structural
// scene editing needs its own reference-fixup pass over mesh/material/skin
// indices and node-hierarchy `children` arrays — out of M1's document-core
// scope, though the shared `fixupReferences` helper (fixup-references.ts)
// they will use already exists, built for `GraphEdit.removeNode`).
import type { Command } from "./command.js";
import { makeCommandId } from "./command.js";
import { setPathFragment } from "./edit-fragments.js";
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
    return {
      id: makeCommandId("set-transform"),
      label: `Set transform on node ${nodeIndex}`,
      coalesceKey: `transform:${nodeIndex}`,
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

  /** STUB (M8): structural node insertion. */
  addNode(): never {
    throw new SceneEditNotImplementedError("addNode");
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
