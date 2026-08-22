// SceneEdit command factories — v1 subset: property edits on existing scene
// elements (`setTransform`, `setName`, `setMaterialProperty`,
// `setAudioEmitterProperty`), a minimal APPEND-ONLY subset of structural
// factories (`addNode`, `addMesh`, `addMaterial`, `addAccessor`,
// `addBufferView`, `addBuffer`, DOC-046) added ahead of schedule for
// `@gltf-studio/agent-mock`'s procedural asset-generation template — see
// docs/adr/0004-agentic-authoring-as-command-producer.md's "asset generation
// pulls scene-structural mutation earlier than the M8 plan assumed"
// consequence — PLUS (DOC-048, M8 part 1) `removeNode`: full structural
// subtree deletion with a complete reference-fixup pass, built on the
// shared `fixupReferences` helper (fixup-references.ts), extended by
// DOC-048 with the scene-specific reference kinds `GraphEdit.removeNode`
// never needed (raw index arrays/scalars, and a graph node's literal
// `configuration.nodeIndex`) — PLUS (DOC-052/DOC-053, M8 part 2)
// `reparentNode`/`duplicateNode`, completing scene authoring: moving an
// EXISTING node under a different existing parent (or to/from scene root),
// and deep-copying a node+subtree as new, append-only nodes sharing every
// non-node resource reference. Scene authoring (add/delete/reparent/
// duplicate) is now complete as of this change; sibling reordering beyond
// `reparentNode`'s own `insertIndex` remains a possible future polish, not a
// gap in v1 scope (see this file's own `reparentNode`/`duplicateNode` doc
// comments and specs/document-model.md's DOC-052/053).
import type { Command } from "./command.js";
import { combineCommandParts, makeCommandId } from "./command.js";
import { appendFragment, deletePathFragment, setPathFragment, type PatchPair } from "./edit-fragments.js";
import { fixupReferences, type ReferenceKind } from "./fixup-references.js";
import { formatPointer, getIn } from "./json-pointer.js";
import { applyPatches } from "./patch.js";
import type { EditorDocument } from "./document.js";
import { cubeGeometry, sphereGeometry, planeGeometry, encodeCubeBuffer, encodeBase64, silentWavBuffer, type CubeGeometry } from "./primitives.js";
import { mat4Decompose, mat4FromTranslationRotationScale, mat4Identity, mat4Invert, mat4Multiply, type Mat4, type Quat, type Vec3 } from "./mat-utils.js";

/**
 * DOC-052: thrown by `SceneEdit.reparentNode` when the requested
 * `newParentIndex` is `nodeIndex` itself, or one of `nodeIndex`'s own
 * descendants — either would disconnect `nodeIndex`'s subtree from the rest
 * of the node graph (a node can't be its own ancestor once glTF's
 * `children`-array-only forest structure is walked from any scene root) or
 * outright create a cycle no `children` walk (`flattenSceneTree`,
 * `collectSubtreeIndices`) could ever terminate over. Callers (the scene
 * tree's drag-and-drop reparent handler) are expected to catch this and
 * surface it as a toast rather than letting it propagate as an unhandled
 * exception — dragging a row onto its own descendant is an easy accidental
 * drop target, not a programming error.
 */
export class CycleReparentError extends Error {
  constructor(
    public readonly nodeIndex: number,
    public readonly newParentIndex: number
  ) {
    super(
      `SceneEdit.reparentNode: cannot reparent node ${nodeIndex} under node ${newParentIndex} — ${newParentIndex} is node ${nodeIndex} itself or one of its own descendants, which would create a cycle.`
    );
    this.name = "CycleReparentError";
  }
}

/**
 * DOC-066 (clip management): thrown by `SceneEdit.removeAudioClip` when the
 * clip is still referenced by at least one `extensions.KHR_audio_emitter.
 * sources[]` entry's `audio` field — mirroring `GraphEdit.removeVariable`'s
 * `VariableInUseError`/DOC-055 block-don't-dangle policy one extension over:
 * `audio[]` is a shared declaration table every `sources[].audio` reference
 * assumes populated, the same shape as `variables[]`/`events[]`. Carries
 * `usageCount` (distinct referencing `sources[]` entries) so a caller (the
 * Assets > Audio Clips tab's delete button) can surface an exact "used by N
 * source(s)" toast rather than a bare rejection.
 */
export class AudioClipInUseError extends Error {
  readonly clipIndex: number;
  readonly usageCount: number;
  constructor(clipIndex: number, usageCount: number, label?: string) {
    super(
      `Audio clip ${label ? `"${label}"` : `#${clipIndex}`} is used by ${usageCount} source${usageCount === 1 ? "" : "s"} — remove those references before deleting it.`
    );
    this.name = "AudioClipInUseError";
    this.clipIndex = clipIndex;
    this.usageCount = usageCount;
  }
}

/**
 * DOC-066: counts `extensions.KHR_audio_emitter.sources[]` entries whose
 * `audio` field equals `clipIndex` — `SceneEdit.removeAudioClip`'s
 * blocked-delete precondition (mirrors `GraphEdit.countVariableUsage`,
 * DOC-055), exported so the Assets tab's delete-button enabled/disabled
 * state and its confirmation toast can use the identical count.
 */
export function countAudioClipUsage(json: unknown, clipIndex: number): number {
  const sources = (getIn(json, ["extensions", "KHR_audio_emitter", "sources"]) as Array<{ audio?: number }> | undefined) ?? [];
  return sources.filter((source) => source?.audio === clipIndex).length;
}

/**
 * DOC-048: depth-first pre-order walk of `rootIndex` and every descendant
 * reachable via `children` (cycle-guarded, same defensive convention
 * `packages/app/src/lib/gltf-scene.ts`'s `flattenSceneTree` uses for a
 * malformed cyclic graph) — the full set of node indices one
 * `SceneEdit.removeNode(document, rootIndex)` call deletes (RECOMMENDED v1
 * policy: delete the whole subtree as one command; see this file's header).
 */
function collectSubtreeIndices(json: unknown, rootIndex: number): number[] {
  const nodes = (getIn(json, ["nodes"]) as Array<{ children?: number[] }> | undefined) ?? [];
  const visited = new Set<number>();
  const order: number[] = [];
  function visit(index: number): void {
    if (visited.has(index)) return;
    visited.add(index);
    order.push(index);
    for (const child of nodes[index]?.children ?? []) visit(child);
  }
  visit(rootIndex);
  return order;
}

/** DOC-048: the node whose `children` currently lists `childIndex`, or `null` when `childIndex` is a scene-root node (or unparented/unreferenced). First match wins — glTF's node graph is a forest, not expected to have more than one parent per node. */
function findParentNodeIndex(json: unknown, childIndex: number): number | null {
  const nodes = (getIn(json, ["nodes"]) as Array<{ children?: number[] }> | undefined) ?? [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.children?.includes(childIndex)) return i;
  }
  return null;
}

/** The current default scene's index — `json.scene ?? 0` — the same fallback `appendNodeFragment`'s scene-root branch and `flattenSceneTree` (`packages/app/src/lib/gltf-scene.ts`) both use. */
function defaultSceneIndex(json: unknown): number {
  return (getIn(json, ["scene"]) as number | undefined) ?? 0;
}

/**
 * DOC-052: a node's "membership array" — either its parent's `children`
 * (`["nodes", parentIndex, "children"]`) when it has one, or the current
 * default scene's root `nodes` array (`["scenes", sceneIndex, "nodes"]`)
 * when `parentIndex` is `null` — the ONE array, per `findParentNodeIndex`'s
 * own "glTF is a forest" assumption, that currently lists a given node index
 * as belonging to it. Shared by `reparentNode` (moving a node OUT of its old
 * one, INTO a new one) and `duplicateNode` (finding where to splice the
 * duplicate in as a sibling).
 */
function membershipArrayPath(json: unknown, parentIndex: number | null): (string | number)[] {
  return parentIndex === null ? ["scenes", defaultSceneIndex(json), "nodes"] : ["nodes", parentIndex, "children"];
}

/**
 * DOC-052: removes the first occurrence of `value` from the array at
 * `arrayPath` (throwing if it's not a real array or doesn't contain `value`
 * — both would mean a caller mis-tracked a node's own membership, a bug in
 * the caller rather than a legitimate empty/absent-property case). Mirrors
 * `fixup-references.ts`'s `indexArray` drop-on-match convention: when the
 * removal would leave the array empty, the whole property is removed rather
 * than left as `[]` (an empty `children`/`scenes[].nodes` is not how this
 * codebase represents "none" — DOC-048/DOC-049's same convention).
 */
function removeFromArrayFragment(json: unknown, arrayPath: ReadonlyArray<string | number>, value: number): PatchPair {
  const current = getIn(json, arrayPath.map(String)) as unknown[] | undefined;
  const at = current?.indexOf(value) ?? -1;
  if (!current || at === -1) {
    throw new Error(`SceneEdit: expected ${value} to be present in the array at ${formatPointer(arrayPath)}.`);
  }
  if (current.length === 1) {
    const arrayPointer = formatPointer(arrayPath);
    return { patches: [{ op: "remove", path: arrayPointer }], inverse: [{ op: "add", path: arrayPointer, value: current }] };
  }
  const elementPointer = formatPointer([...arrayPath, at]);
  return { patches: [{ op: "remove", path: elementPointer }], inverse: [{ op: "add", path: elementPointer, value }] };
}

/**
 * DOC-052: inserts `value` into the array at `arrayPath` — creating the
 * array itself (as `add` of a fresh one-element array) if it's currently
 * absent, mirroring `appendFragment`'s own "creating it if absent" handling
 * — at `insertIndex` when given (clamped into `[0, currentLength]`), else
 * appended as the last element (the same "lands as the last child"
 * default `appendNodeFragment`/`addNode` already established for a BRAND
 * NEW node, DOC-047, now reused for reparenting/duplicating an EXISTING
 * one).
 */
function insertIntoArrayFragment(json: unknown, arrayPath: ReadonlyArray<string | number>, value: number, insertIndex?: number): PatchPair {
  const current = getIn(json, arrayPath.map(String)) as unknown[] | undefined;
  if (!current || current.length === 0) {
    const arrayPointer = formatPointer(arrayPath);
    return { patches: [{ op: "add", path: arrayPointer, value: [value] }], inverse: [{ op: "remove", path: arrayPointer }] };
  }
  const at = insertIndex === undefined ? current.length : Math.max(0, Math.min(insertIndex, current.length));
  const elementPointer = formatPointer([...arrayPath, at]);
  return { patches: [{ op: "add", path: elementPointer, value }], inverse: [{ op: "remove", path: elementPointer }] };
}

/**
 * DOC-048: every `ReferenceKind` `removeNode` must fix up for a single
 * `target` node's removal, computed fresh against the CURRENT `json` at each
 * step of a (possibly multi-node) subtree deletion — see `removeNode`'s own
 * comment for why this is recomputed per step rather than once upfront.
 * Covers: `scenes[].nodes` and every OTHER node's `children` (both
 * `indexArray`, drop-on-match — `target`'s OWN `children` is skipped since
 * that whole node object is about to be deleted anyway), `skins[].joints`/
 * `skeleton` (defensive: this app never authors or renders skins, but an
 * IMPORTED asset can carry them, and leaving a shifted-but-unfixed joint
 * index would silently corrupt that asset), `animations[].channels` (drop
 * the channel when it targets `target` exactly — DOC-048's resolved policy
 * choice, "remove channels targeting deleted nodes" over retargeting to
 * nothing), every `KHR_interactivity` graph node's literal
 * `configuration.nodeIndex` (`event/onSelect`/`onHoverIn`/`onHoverOut` —
 * NOT `graphNodeRef`: a graph node's `{node: N}` value/flow wiring
 * addresses ANOTHER GRAPH NODE, a wholly separate index space from the
 * scene node being deleted here — that's `GraphEdit.removeNode`'s own
 * concern), and `KHR_interactivity` pointer-template literal strings
 * anywhere in the document (`pointer/get|set|interpolate`'s
 * `configuration.pointer`). `node.camera`/`node.extensions.
 * KHR_lights_punctual.light`/`node.extensions.KHR_audio_emitter.emitter`
 * need NO fixup here — they index the `cameras`/`lights`/`emitters`
 * registries, not the `nodes` array, so they simply vanish with `target`'s
 * own node object; those registries are intentionally not garbage-collected
 * (this file's header comment / DOC-048).
 */
function referenceKindsForRemoval(json: unknown, target: number): ReferenceKind[] {
  const refKinds: ReferenceKind[] = [];

  const scenes = (getIn(json, ["scenes"]) as unknown[] | undefined) ?? [];
  scenes.forEach((_, sceneIndex) => refKinds.push({ kind: "indexArray", path: ["scenes", sceneIndex, "nodes"] }));

  const allNodes = (getIn(json, ["nodes"]) as unknown[] | undefined) ?? [];
  allNodes.forEach((_, nodeIndex) => {
    if (nodeIndex === target) return; // target's own children field is going away with it — nothing to fix up.
    refKinds.push({ kind: "indexArray", path: ["nodes", nodeIndex, "children"] });
  });

  const skins = (getIn(json, ["skins"]) as unknown[] | undefined) ?? [];
  skins.forEach((_, skinIndex) => {
    refKinds.push({ kind: "indexArray", path: ["skins", skinIndex, "joints"] });
    refKinds.push({ kind: "indexScalar", path: ["skins", skinIndex, "skeleton"] });
  });

  const animations = (getIn(json, ["animations"]) as unknown[] | undefined) ?? [];
  animations.forEach((_, animationIndex) => {
    refKinds.push({ kind: "indexArray", path: ["animations", animationIndex, "channels"], nodeFieldPath: ["target", "node"] });
  });

  // NOTE: deliberately NOT `graphNodeRef` here — that kind shifts a graph
  // node's `{node: N}` value/flow wiring to ANOTHER GRAPH NODE, a completely
  // separate index space from the SCENE node `removeNode` is deleting (it's
  // `GraphEdit.removeNode`'s own concern, for deleting a GRAPH node). The
  // only graph-internal field that ever holds a raw SCENE-node index is the
  // literal `configuration.nodeIndex` handled below.
  const graphs = (getIn(json, ["extensions", "KHR_interactivity", "graphs"]) as unknown[] | undefined) ?? [];
  graphs.forEach((_, graphIndex) => {
    const graphPath = ["extensions", "KHR_interactivity", "graphs", graphIndex];
    refKinds.push({ kind: "graphConfigLiteral", graphPath, field: "nodeIndex" });
  });

  refKinds.push({ kind: "jsonPointerLiteral", arrayName: "nodes" });

  return refKinds;
}

/**
 * M8-lite (specs/ux-scene-tree.md UX-206): shared by `addNode` and the
 * composite `addLightNode`/`addCameraNode`/`addAudioEmitterNode`/
 * `addPrimitiveMeshNode` factories below — appends `nodeDefinition` to
 * `json.nodes`, then appends its new index into EXACTLY ONE of:
 *   - `opts.parentNodeIndex`'s `children` array (creating it if absent),
 *     when given — the scene tree's "+ Add" landing a new node under the
 *     currently-selected node, append-only (last child, no reordering,
 *     no reparenting of anything that already exists); or otherwise
 *   - the current default scene's root `nodes` array
 *     (`json.scenes[json.scene ?? 0].nodes`), when `opts.addToScene` is not
 *     explicitly `false` (the pre-existing `addNode` default) — the "no
 *     node selected" case, landing at scene root.
 * Both branches are one combined fragment, so the caller's own combine (folding
 * in whatever ELSE it appended — a light/camera/mesh/emitter — ahead of the
 * node) still yields exactly one undo step end to end.
 */
function appendNodeFragment(
  json: unknown,
  nodeDefinition: Record<string, unknown>,
  opts: { addToScene?: boolean; parentNodeIndex?: number }
): PatchPair & { index: number } {
  const nodeFragment = appendFragment(json, ["nodes"], nodeDefinition);
  const jsonAfterNode = applyPatches(json, nodeFragment.patches);

  if (opts.parentNodeIndex !== undefined) {
    const childrenFragment = appendFragment(jsonAfterNode, ["nodes", opts.parentNodeIndex, "children"], nodeFragment.index);
    const combined = combineCommandParts([nodeFragment, childrenFragment]);
    return { index: nodeFragment.index, patches: combined.patches, inverse: combined.inverse };
  }

  if (opts.addToScene === false) {
    return { index: nodeFragment.index, patches: nodeFragment.patches, inverse: nodeFragment.inverse };
  }

  const sceneIndex = (getIn(jsonAfterNode, ["scene"]) as number | undefined) ?? 0;
  const sceneFragment = appendFragment(jsonAfterNode, ["scenes", sceneIndex, "nodes"], nodeFragment.index);
  const combined = combineCommandParts([nodeFragment, sceneFragment]);
  return { index: nodeFragment.index, patches: combined.patches, inverse: combined.inverse };
}

/** find-or-appends `entry` into `json.extensionsUsed` — a no-op fragment when it's already listed. Mirrors `GraphEdit.ensureGraph`'s (DOC-041) own `extensionsUsed` handling. */
function ensureExtensionUsedFragment(json: unknown, extensionName: string): PatchPair {
  const extensionsUsed = (getIn(json, ["extensionsUsed"]) as string[] | undefined) ?? [];
  return extensionsUsed.includes(extensionName) ? { patches: [], inverse: [] } : appendFragment(json, ["extensionsUsed"], extensionName);
}

/**
 * DOC-065: a brand-new `KHR_lights_punctual` light definition for
 * `addLightNode`'s per-type defaults — see that factory's doc comment for
 * the intensity-value rationale. Also reused by `setLightType` (below) as
 * the seed for the type-specific fields (`spot`) it adds when converting
 * INTO a type the light didn't previously have any type-specific fields
 * for.
 */
function lightDefaultsForType(type: "point" | "spot" | "directional"): Record<string, unknown> {
  switch (type) {
    case "directional":
      return { type, intensity: 3 };
    case "point":
      return { type, intensity: 500 };
    case "spot":
      return { type, intensity: 500, spot: { innerConeAngle: 0, outerConeAngle: Math.PI / 4 } };
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
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx; also the
   * source-side sibling `@gltf-studio/audio-canvas`'s audio-graph canvas
   * uses, DOC-062, to persist a synthetic `audio-buffer-source` terminal
   * node's canvas position — UX-617): sets an arbitrary property on
   * `extensions.KHR_audio_emitter.sources[sourceIndex]` — the root-level
   * sources registry an emitter's own `sources: number[]` array indexes
   * into (e.g. `["gain"]`, `["playbackRate"]`, `["loop"]`, `["autoplay"]`,
   * `["audio"]` to rebind the clip, or `["extras","gltfi"]` for a canvas
   * position). A SEPARATE factory from `setAudioEmitterProperty` because
   * `sources[]` and `emitters[]` are two distinct root arrays under the
   * same extension, not a parent/child relationship `setAudioEmitterProperty`'s
   * `propertyPath` could reach into — an emitter only stores source INDICES
   * (`sources: number[]`), never the source objects themselves.
   */
  setAudioSourceProperty(document: EditorDocument, sourceIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["extensions", "KHR_audio_emitter", "sources", sourceIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-audio-source-property"),
      label: `Set audio source ${sourceIndex} ${propertyPath.join(".")}`,
      coalesceKey: `audio-source-property:${sourceIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): appends a
   * `KHR_audio_environment` reverb zone/environment definition to the ROOT
   * `extensions.KHR_audio_environment.environments[]` registry (`reverb`
   * seeded from `spatial.ts`'s 13-entry `REVERB_PRESETS` table via
   * `opts.reverbPreset`, defaulting to `"mediumRoom"`), scaffolding the
   * extension's `extensionsUsed` entry when it isn't already listed —
   * mirrors `addLightNode`'s own find-or-scaffold pattern. This ONLY
   * creates the environment registry entry — it does not bind it to any
   * node (a zone, `addAudioZone`) or set it as any scene's default
   * (`setSceneAudioEnvironment`); a caller composes those separately.
   */
  addAudioEnvironment(document: EditorDocument, name: string, opts: { reverbPreset?: string } = {}): { command: Command; index: number } {
    const environmentFragment = appendFragment(document.json, ["extensions", "KHR_audio_environment", "environments"], {
      name,
      reverb: { preset: opts.reverbPreset ?? "mediumRoom", mix: 0.35 }
    });
    const jsonAfterEnvironment = applyPatches(document.json, environmentFragment.patches);
    const usedFragment = ensureExtensionUsedFragment(jsonAfterEnvironment, "KHR_audio_environment");
    const combined = combineCommandParts([environmentFragment, usedFragment]);
    return {
      index: environmentFragment.index,
      command: {
        id: makeCommandId("add-audio-environment"),
        label: `Add audio environment "${name}"`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /** Sets an arbitrary property on the ROOT `extensions.KHR_audio_environment.environments[environmentIndex]` entry (e.g. `["reverb","preset"]`, `["reverb","mix"]`, `["doppler","enabled"]`) — mirrors `setAudioEmitterProperty`'s shape. */
  setAudioEnvironmentProperty(document: EditorDocument, environmentIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["extensions", "KHR_audio_environment", "environments", environmentIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-audio-environment-property"),
      label: `Set audio environment ${environmentIndex} ${propertyPath.join(".")}`,
      coalesceKey: `audio-environment-property:${environmentIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): appends a
   * `KHR_audio_environment` listener to the ROOT
   * `extensions.KHR_audio_environment.listeners[]` registry, scaffolding
   * `extensionsUsed` the same way `addAudioEnvironment` does. Not bound to
   * any node or scene by this call alone — see `setNodeAudioEnvironment`
   * (a camera node's `listener` binding) and `setSceneAudioActiveListener`
   * (the scene-pinned default, `WebAudioHost.selectListener`'s fallback
   * order).
   */
  addAudioListener(document: EditorDocument, name: string, opts: { gain?: number; spatializationModel?: string } = {}): { command: Command; index: number } {
    const listenerFragment = appendFragment(document.json, ["extensions", "KHR_audio_environment", "listeners"], {
      name,
      gain: opts.gain ?? 1,
      spatializationModel: opts.spatializationModel ?? "HRTF"
    });
    const jsonAfterListener = applyPatches(document.json, listenerFragment.patches);
    const usedFragment = ensureExtensionUsedFragment(jsonAfterListener, "KHR_audio_environment");
    const combined = combineCommandParts([listenerFragment, usedFragment]);
    return {
      index: listenerFragment.index,
      command: {
        id: makeCommandId("add-audio-listener"),
        label: `Add audio listener "${name}"`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /** Sets an arbitrary property on the ROOT `extensions.KHR_audio_environment.listeners[listenerIndex]` entry (e.g. `["gain"]`, `["spatializationModel"]`) — mirrors `setAudioEmitterProperty`'s shape. */
  setAudioListenerProperty(document: EditorDocument, listenerIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["extensions", "KHR_audio_environment", "listeners", listenerIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-audio-listener-property"),
      label: `Set audio listener ${listenerIndex} ${propertyPath.join(".")}`,
      coalesceKey: `audio-listener-property:${listenerIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): sets an
   * arbitrary property on a NODE's own `extensions.KHR_audio_environment`
   * object — the same per-node object the real extension overloads for TWO
   * distinct purposes (`WebAudioHost`'s `GltfNodeAudio` type, `spatial.ts`'s
   * `ZoneBinding`): a reverb ZONE binding (`["environment"]` the zone's
   * environment index, `["shape","type"|"size"|"radius"]`,
   * `["blendDistance"]`, `["priority"]`) on any node, OR a LISTENER binding
   * (`["listener"]`, an index into `extensions.KHR_audio_environment.
   * listeners[]`) typically on a camera node — both live at the exact same
   * JSON location, so one generic setter (mirroring `setAudioZoneProperty`'s
   * sibling factories' shape) covers either. Does NOT scaffold
   * `extensionsUsed` itself (unlike `addAudioZone`) — callers use this for
   * incremental edits to an object `addAudioZone`/a prior call already
   * created.
   */
  setNodeAudioEnvironmentProperty(document: EditorDocument, nodeIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["nodes", nodeIndex, "extensions", "KHR_audio_environment", ...propertyPath], value);
    return {
      id: makeCommandId("set-node-audio-environment-property"),
      label: `Set node ${nodeIndex} audio environment ${propertyPath.join(".")}`,
      coalesceKey: `node-audio-environment-property:${nodeIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): turns
   * `nodeIndex` into a `KHR_audio_environment` reverb zone in one command —
   * sets its `extensions.KHR_audio_environment` object wholesale to
   * `{ environment: environmentIndex, shape, blendDistance, priority }`
   * (default shape a radius-5 sphere; `WebAudioHost`'s `selectEnvironment`/
   * `spatial.ts`'s zone-selection algorithm reads all four), scaffolding
   * `extensionsUsed`. Subsequent field-level edits go through
   * `setNodeAudioEnvironmentProperty`. Overwrites any PRIOR
   * `extensions.KHR_audio_environment` value the node had (e.g. a listener
   * binding) — a node is authored as a zone OR a listener in this UI, not
   * both; the caller is expected to only offer this action for a node that
   * isn't already a listener.
   */
  addAudioZone(
    document: EditorDocument,
    nodeIndex: number,
    environmentIndex: number,
    opts: { shape?: Record<string, unknown>; blendDistance?: number; priority?: number } = {}
  ): Command {
    const zoneValue = {
      environment: environmentIndex,
      shape: opts.shape ?? { type: "sphere", radius: 5 },
      blendDistance: opts.blendDistance ?? 1,
      priority: opts.priority ?? 0
    };
    const zoneFragment = setPathFragment(document.json, ["nodes", nodeIndex, "extensions", "KHR_audio_environment"], zoneValue);
    const jsonAfterZone = applyPatches(document.json, zoneFragment.patches);
    const usedFragment = ensureExtensionUsedFragment(jsonAfterZone, "KHR_audio_environment");
    const combined = combineCommandParts([zoneFragment, usedFragment]);
    return {
      id: makeCommandId("add-audio-zone"),
      label: `Add environment zone on node ${nodeIndex}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): sets (or,
   * given `null`, clears) `scenes[sceneIndex].extensions.KHR_audio_environment.
   * environment` — the scene-wide DEFAULT environment `WebAudioHost.
   * collectZonesAndDefault` falls back to when the listener isn't currently
   * inside any zone (`spatial.ts`'s `selectEnvironment`).
   */
  setSceneAudioEnvironment(document: EditorDocument, sceneIndex: number, environmentIndex: number | null): Command {
    const path = ["scenes", sceneIndex, "extensions", "KHR_audio_environment", "environment"];
    const fragment = environmentIndex === null ? deletePathFragment(document.json, path) : setPathFragment(document.json, path, environmentIndex);
    return {
      id: makeCommandId("set-scene-audio-environment"),
      label: `Set scene ${sceneIndex} default audio environment`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Emitter/environment authoring (specs/ux-inspector.md UX-4xx): sets (or,
   * given `null`, clears) `scenes[sceneIndex].extensions.KHR_audio_environment.
   * activeListener` — the scene-pinned listener index `WebAudioHost.
   * selectListener` prefers above any node-bound listener when present.
   */
  setSceneAudioActiveListener(document: EditorDocument, sceneIndex: number, listenerIndex: number | null): Command {
    const path = ["scenes", sceneIndex, "extensions", "KHR_audio_environment", "activeListener"];
    const fragment = listenerIndex === null ? deletePathFragment(document.json, path) : setPathFragment(document.json, path, listenerIndex);
    return {
      id: makeCommandId("set-scene-audio-active-listener"),
      label: `Set scene ${sceneIndex} active audio listener`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Richer inspector (specs/ux-inspector.md UX-417): sets an arbitrary
   * property on the ROOT `extensions.KHR_lights_punctual.lights[lightIndex]`
   * registry entry (e.g. `["intensity"]`, `["color"]`, `["spot",
   * "innerConeAngle"]`) — mirrors `setAudioEmitterProperty`'s own
   * root-registry-by-index shape exactly (a light is addressed by its LIGHT
   * index, not by the node that happens to reference it via
   * `node.extensions.KHR_lights_punctual.light`, same indirection
   * `tables.ts`'s `lightsByIndex` in the vendored three-adapter uses on the
   * render side).
   */
  setLightProperty(document: EditorDocument, lightIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["extensions", "KHR_lights_punctual", "lights", lightIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-light-property"),
      label: `Set light ${lightIndex} ${propertyPath.join(".")}`,
      coalesceKey: `light-property:${lightIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-065 (full punctual-light control, specs/ux-inspector.md UX-417 r2):
   * converts an EXISTING light at ROOT `extensions.KHR_lights_punctual.
   * lights[lightIndex]` to `newType`, as ONE undoable command — a single
   * `replace` of the whole light object (mirroring `AudioGraphEdit.
   * replaceAudioGraph`'s, DOC-064, whole-object-replace shape, the same
   * "simpler and still fully DOC-008-exact for a realistic object size"
   * tradeoff that entry documents), rather than a sequence of individual
   * `setLightProperty` field add/removes. `name`/`color`/`intensity` (and
   * any other field this schema doesn't otherwise touch, e.g. `extras`) are
   * preserved UNCONDITIONALLY via object spread — never dropped or reset by
   * a type change. Per KHR_lights_punctual's own schema (each field valid
   * for only SOME light types): `range` (point/spot only) is carried over
   * unchanged when converting between point and spot (both meaningful) and
   * DROPPED when converting to `"directional"` (meaningless there, and the
   * vendored pointer-router's own `range` family already no-ops + logs a
   * diagnostic note for a directional target — dropping it here keeps the
   * authored JSON honest rather than leaving a field the renderer ignores).
   * `spot.{innerConeAngle,outerConeAngle}` is DROPPED when converting away
   * from `"spot"` (meaningless for point/directional) and (re)SEEDED with
   * `lightDefaultsForType`'s spot defaults when converting INTO `"spot"`
   * from a type that had no prior `spot` object to carry over — converting
   * spot -> point -> spot back to back does lose whatever custom cone
   * angles were set (there is nowhere in a point/directional light's own
   * JSON shape to stash them for later, a deliberate v1 simplicity choice,
   * not an oversight). Throws if `lightIndex` doesn't resolve to an
   * existing light (same "read-before-write fail-fast" discipline
   * `AudioGraphEdit.replaceAudioGraph` and `getAudioGraph` already
   * establish) — there's no sensible "convert a light that doesn't exist"
   * value to build an inverse-patch pair against, and every other
   * `setLightProperty`/`setCameraProperty`-shaped factory in this file
   * assumes its target root-registry index already exists too.
   */
  setLightType(document: EditorDocument, lightIndex: number, newType: "point" | "spot" | "directional"): Command {
    const path = ["extensions", "KHR_lights_punctual", "lights", lightIndex];
    const current = getIn(document.json, path.map(String)) as Record<string, unknown> | undefined;
    if (current === undefined) {
      throw new Error(`SceneEdit.setLightType: no light at index ${lightIndex}.`);
    }
    const next: Record<string, unknown> = { ...current, type: newType };
    if (newType === "directional") {
      delete next.range;
      delete next.spot;
    } else if (newType === "point") {
      delete next.spot;
    } else {
      // "spot": carry over an existing spot object (e.g. re-converting
      // spot -> point -> spot inside one still-uncommitted editing session
      // isn't possible today, see doc comment above, but converting
      // directly TO spot from a light that — unusually — already carries a
      // leftover `spot` object, e.g. hand-authored JSON, is still honored).
      next.spot = (current.spot as Record<string, unknown> | undefined) ?? (lightDefaultsForType("spot").spot as Record<string, unknown>);
    }
    const fragment = setPathFragment(document.json, path, next);
    return {
      id: makeCommandId("set-light-type"),
      label: `Set light ${lightIndex} type to ${newType}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Richer inspector (specs/ux-inspector.md UX-418): sets an arbitrary
   * property on `cameras[cameraIndex]` (e.g. `["perspective", "yfov"]`) —
   * mirrors `setMaterialProperty`'s own by-index-into-a-root-array shape.
   * Core glTF (no extension involved), unlike lights/audio emitters.
   */
  setCameraProperty(document: EditorDocument, cameraIndex: number, propertyPath: Array<string | number>, value: unknown): Command {
    const fragment = setPathFragment(document.json, ["cameras", cameraIndex, ...propertyPath], value);
    return {
      id: makeCommandId("set-camera-property"),
      label: `Set camera ${cameraIndex} ${propertyPath.join(".")}`,
      coalesceKey: `camera-property:${cameraIndex}:${propertyPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Richer inspector (specs/ux-inspector.md UX-416): removes a whole
   * texture-info object (e.g. `["pbrMetallicRoughness", "baseColorTexture"]`,
   * `["normalTexture"]`) from `materials[materialIndex]` — the Inspector's
   * texture-slot "Clear" control. v1 is READ + CLEAR only (see that
   * requirement's own doc comment for why texture REPLACEMENT is a bigger,
   * separately-scoped lift) — this factory is the "clear" half; there is no
   * "set" half yet. Throws (via `deletePathFragment`) if the slot is already
   * unset — callers only show a Clear control for a slot that IS set, so
   * this should never fire in practice.
   */
  clearMaterialTexture(document: EditorDocument, materialIndex: number, textureInfoPath: Array<string | number>): Command {
    const fragment = deletePathFragment(document.json, ["materials", materialIndex, ...textureInfoPath]);
    return {
      id: makeCommandId("clear-material-texture"),
      label: `Clear material ${materialIndex} ${textureInfoPath.join(".")}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * Richer inspector (specs/ux-inspector.md UX-416): sets ONE
   * `KHR_texture_transform` field (`offset`/`scale`/`rotation`) on a
   * material's texture-info object (`textureInfoPath`, e.g.
   * `["pbrMetallicRoughness", "baseColorTexture"]`), scaffolding the
   * extension's `extensionsUsed` entry in the SAME command when it isn't
   * already listed — mirrors `addLightNode`/`addAudioEmitterNode`'s own
   * find-or-scaffold `ensureExtensionUsedFragment` pattern. Folding the
   * `extensionsUsed` scaffold into every write (not just a hypothetical
   * first one) is deliberately cheap and idempotent
   * (`ensureExtensionUsedFragment` no-ops once it's already listed) rather
   * than requiring the caller to know whether this is the "first" transform
   * write for the document.
   */
  setMaterialTextureTransform(
    document: EditorDocument,
    materialIndex: number,
    textureInfoPath: Array<string | number>,
    field: "offset" | "scale" | "rotation",
    value: unknown
  ): Command {
    const path = ["materials", materialIndex, ...textureInfoPath, "extensions", "KHR_texture_transform", field];
    const valueFragment = setPathFragment(document.json, path, value);
    const jsonAfterValue = applyPatches(document.json, valueFragment.patches);
    const usedFragment = ensureExtensionUsedFragment(jsonAfterValue, "KHR_texture_transform");
    const combined = combineCommandParts([valueFragment, usedFragment]);
    return {
      id: makeCommandId("set-material-texture-transform"),
      label: `Set material ${materialIndex} ${textureInfoPath.join(".")} ${field}`,
      coalesceKey: `material-texture-transform:${materialIndex}:${textureInfoPath.join(".")}:${field}`,
      patches: combined.patches,
      inverse: combined.inverse
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
   * second document read. Also accepts `opts.parentNodeIndex` (M8-lite,
   * specs/ux-scene-tree.md UX-206): when given, the new node's index is
   * appended to THAT node's `children` array instead of the scene's root
   * `nodes` array (and `addToScene` is ignored) — see `appendNodeFragment`'s
   * own doc comment. Append-only either way: no reparenting of anything
   * that already exists, no removal — see this file's header comment.
   */
  addNode(
    document: EditorDocument,
    nodeDefinition: Record<string, unknown>,
    opts: { addToScene?: boolean; parentNodeIndex?: number } = {}
  ): { command: Command; index: number } {
    const fragment = appendNodeFragment(document.json, nodeDefinition, opts);
    const label = `Add node${typeof nodeDefinition.name === "string" ? ` "${nodeDefinition.name}"` : ""}`;
    return {
      index: fragment.index,
      command: { id: makeCommandId("add-node"), label, patches: fragment.patches, inverse: fragment.inverse }
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

  /**
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206): the scene tree's
   * "+ Add" > Mesh entry. Appends a procedurally-generated primitive
   * (`cubeGeometry`/`sphereGeometry`/`planeGeometry`, `primitives.ts`) as a
   * fresh buffer+3 bufferViews+3 accessors+material+mesh+node, all as ONE
   * combined command — the same append chain
   * `@gltf-studio/agent-mock`'s add-cube template (AG-014) already builds by
   * hand via `CommandChain`, just folded into a single `Command` here since
   * the scene tree's add-menu has no proposal-review UI needing the
   * individually-labeled steps a `Proposal.commands` array is for. Lands
   * under `opts.parentNodeIndex` (the selected node) when given, else the
   * current default scene's root (`appendNodeFragment`).
   */
  addPrimitiveMeshNode(
    document: EditorDocument,
    kind: "cube" | "sphere" | "plane",
    name: string,
    opts: { parentNodeIndex?: number } = {}
  ): { command: Command; index: number } {
    const geometry: CubeGeometry = kind === "cube" ? cubeGeometry() : kind === "sphere" ? sphereGeometry() : planeGeometry();
    const encoded = encodeCubeBuffer(geometry);

    const bufferFragment = appendFragment(document.json, ["buffers"], { byteLength: encoded.byteLength, uri: encoded.uri });
    let json = applyPatches(document.json, bufferFragment.patches);

    const posViewFragment = appendFragment(json, ["bufferViews"], {
      buffer: bufferFragment.index,
      byteOffset: encoded.positions.byteOffset,
      byteLength: encoded.positions.byteLength,
      target: 34962 // ARRAY_BUFFER
    });
    json = applyPatches(json, posViewFragment.patches);

    const normViewFragment = appendFragment(json, ["bufferViews"], {
      buffer: bufferFragment.index,
      byteOffset: encoded.normals.byteOffset,
      byteLength: encoded.normals.byteLength,
      target: 34962
    });
    json = applyPatches(json, normViewFragment.patches);

    const idxViewFragment = appendFragment(json, ["bufferViews"], {
      buffer: bufferFragment.index,
      byteOffset: encoded.indices.byteOffset,
      byteLength: encoded.indices.byteLength,
      target: 34963 // ELEMENT_ARRAY_BUFFER
    });
    json = applyPatches(json, idxViewFragment.patches);

    const posAccFragment = appendFragment(json, ["accessors"], {
      bufferView: posViewFragment.index,
      componentType: 5126, // FLOAT
      count: geometry.positions.length / 3,
      type: "VEC3",
      min: geometry.min,
      max: geometry.max
    });
    json = applyPatches(json, posAccFragment.patches);

    const normAccFragment = appendFragment(json, ["accessors"], {
      bufferView: normViewFragment.index,
      componentType: 5126,
      count: geometry.normals.length / 3,
      type: "VEC3"
    });
    json = applyPatches(json, normAccFragment.patches);

    const idxAccFragment = appendFragment(json, ["accessors"], {
      bufferView: idxViewFragment.index,
      componentType: 5123, // UNSIGNED_SHORT
      count: geometry.indices.length,
      type: "SCALAR"
    });
    json = applyPatches(json, idxAccFragment.patches);

    const materialFragment = appendFragment(json, ["materials"], {
      name: `${name} material`,
      pbrMetallicRoughness: { baseColorFactor: [0.55, 0.65, 0.95, 1] } // solid pale blue, no textures — matches AG-014's add-cube template look
    });
    json = applyPatches(json, materialFragment.patches);

    const meshFragment = appendFragment(json, ["meshes"], {
      name,
      primitives: [
        { attributes: { POSITION: posAccFragment.index, NORMAL: normAccFragment.index }, indices: idxAccFragment.index, material: materialFragment.index }
      ]
    });
    json = applyPatches(json, meshFragment.patches);

    const nodeFragment = appendNodeFragment(json, { name, mesh: meshFragment.index }, opts);
    const combined = combineCommandParts([
      bufferFragment,
      posViewFragment,
      normViewFragment,
      idxViewFragment,
      posAccFragment,
      normAccFragment,
      idxAccFragment,
      materialFragment,
      meshFragment,
      nodeFragment
    ]);
    return {
      index: nodeFragment.index,
      command: { id: makeCommandId("add-primitive-mesh-node"), label: `Add ${kind} "${name}"`, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /**
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206), extended by DOC-065
   * (full punctual-light control, specs/ux-scene-tree.md UX-205/206 r2):
   * the scene tree's "+ Add" > Light submenu (Point/Spot/Directional).
   * Appends a `KHR_lights_punctual` light of `opts.type` (default `"point"`,
   * preserving this factory's pre-DOC-065 behavior for any caller that
   * doesn't pass one) to `extensions.KHR_lights_punctual.lights`,
   * scaffolding the extension + its `extensionsUsed` entry when neither
   * exists yet (mirroring `GraphEdit.ensureGraph`'s, DOC-041, find-or-
   * scaffold pattern for `KHR_interactivity`), plus a node referencing it
   * via `node.extensions.KHR_lights_punctual.light` — all as ONE combined
   * command. Lands under `opts.parentNodeIndex` when given, else scene
   * root. `opts.light`, when given, bypasses `opts.type`'s defaults
   * entirely (a full custom light definition, unchanged pre-existing escape
   * hatch). Per-type defaults (`lightDefaultsForType`) give point/spot a
   * real, visible starting intensity (500, matching this codebase's own
   * `e2e/inspector-fixture.ts` "Lamp" fixture — three.js's own bare default
   * of 1 combined with inverse-square distance falloff renders as
   * effectively invisible at ordinary scene scale) and directional a flat,
   * un-attenuated 3 (directional light has no distance falloff at all, so a
   * much smaller value already reads as bright); spot additionally seeds
   * `spot.{innerConeAngle,outerConeAngle}` explicitly (harmless — these
   * match `GLTFLoader`'s own implicit defaults when `spot` is omitted
   * entirely — so the Inspector's Light section starts with real,
   * inspectable values instead of relying on load-time implicit fill-in).
   */
  addLightNode(
    document: EditorDocument,
    name: string,
    opts: { parentNodeIndex?: number; type?: "point" | "spot" | "directional"; light?: Record<string, unknown> } = {}
  ): { command: Command; index: number } {
    const lightDef = opts.light ?? lightDefaultsForType(opts.type ?? "point");
    const lightFragment = appendFragment(document.json, ["extensions", "KHR_lights_punctual", "lights"], lightDef);
    const jsonAfterLight = applyPatches(document.json, lightFragment.patches);

    const usedFragment = ensureExtensionUsedFragment(jsonAfterLight, "KHR_lights_punctual");
    const jsonAfterUsed = applyPatches(jsonAfterLight, usedFragment.patches);

    const nodeFragment = appendNodeFragment(jsonAfterUsed, { name, extensions: { KHR_lights_punctual: { light: lightFragment.index } } }, opts);
    const combined = combineCommandParts([lightFragment, usedFragment, nodeFragment]);
    return {
      index: nodeFragment.index,
      command: { id: makeCommandId("add-light-node"), label: `Add light "${name}"`, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /**
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206): the scene tree's
   * "+ Add" > Camera entry. Appends a perspective camera to `json.cameras`
   * (core glTF — no extension involved) plus a node referencing it via
   * `node.camera`, as ONE combined command. Lands under
   * `opts.parentNodeIndex` when given, else scene root.
   */
  addCameraNode(document: EditorDocument, name: string, opts: { parentNodeIndex?: number; camera?: Record<string, unknown> } = {}): { command: Command; index: number } {
    const cameraDef = opts.camera ?? { type: "perspective", perspective: { yfov: 0.8, znear: 0.1 } };
    const cameraFragment = appendFragment(document.json, ["cameras"], cameraDef);
    const jsonAfterCamera = applyPatches(document.json, cameraFragment.patches);

    const nodeFragment = appendNodeFragment(jsonAfterCamera, { name, camera: cameraFragment.index }, opts);
    const combined = combineCommandParts([cameraFragment, nodeFragment]);
    return {
      index: nodeFragment.index,
      command: { id: makeCommandId("add-camera-node"), label: `Add camera "${name}"`, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /**
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206), extended by the
   * emitter/environment authoring pass (specs/ux-inspector.md UX-4xx) with
   * `opts.audioIndex`: the scene tree's "+ Add" > Audio Emitter entry.
   * Builds a complete, immediately-auditionable `KHR_audio_emitter` chain —
   * a `sources[]` entry + a positional `emitters[]` entry (with an explicit
   * `positional` object, all four fields `WebAudioHost.buildEmitterChain`
   * actually reads, so the inspector has real starting values rather than
   * blanks-that-fall-back-to-defaults), scaffolding the extension's
   * `extensionsUsed` entry when needed — plus a node referencing the new
   * emitter via `node.extensions.KHR_audio_emitter.emitter`, all as ONE
   * combined command. Lands under `opts.parentNodeIndex` when given, else
   * scene root.
   *
   * `opts.audioIndex`, when given, REUSES an existing
   * `extensions.KHR_audio_emitter.audio[audioIndex]` clip already in the
   * document (e.g. one a previous emitter or an imported asset already
   * carries) instead of generating a fresh silent-WAV placeholder buffer +
   * bufferView + `audio[]` entry — the Add menu's "pick an existing clip"
   * path. Omitted (the default): generates the placeholder exactly as
   * before (`primitives.ts`'s `silentWavBuffer`; see its own doc comment for
   * why a clip is generated at all rather than leaving `sources` empty).
   */
  addAudioEmitterNode(
    document: EditorDocument,
    name: string,
    opts: { parentNodeIndex?: number; audioIndex?: number } = {}
  ): { command: Command; index: number } {
    let json = document.json;
    const generationFragments: PatchPair[] = [];
    let audioIndex = opts.audioIndex;

    if (audioIndex === undefined) {
      const wav = silentWavBuffer();

      const bufferFragment = appendFragment(json, ["buffers"], { byteLength: wav.byteLength, uri: wav.uri });
      json = applyPatches(json, bufferFragment.patches);
      generationFragments.push(bufferFragment);

      const bufferViewFragment = appendFragment(json, ["bufferViews"], { buffer: bufferFragment.index, byteOffset: 0, byteLength: wav.byteLength });
      json = applyPatches(json, bufferViewFragment.patches);
      generationFragments.push(bufferViewFragment);

      const audioFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "audio"], { bufferView: bufferViewFragment.index, mimeType: "audio/wav" });
      json = applyPatches(json, audioFragment.patches);
      generationFragments.push(audioFragment);
      audioIndex = audioFragment.index;
    }

    const sourceFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "sources"], {
      audio: audioIndex,
      gain: 1,
      loop: false,
      autoplay: false
    });
    json = applyPatches(json, sourceFragment.patches);

    const emitterFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "emitters"], {
      type: "positional",
      gain: 1,
      sources: [sourceFragment.index],
      positional: { shapeType: "omnidirectional", distanceModel: "inverse", refDistance: 1, maxDistance: 0, rolloffFactor: 1 }
    });
    json = applyPatches(json, emitterFragment.patches);

    const usedFragment = ensureExtensionUsedFragment(json, "KHR_audio_emitter");
    json = applyPatches(json, usedFragment.patches);

    const nodeFragment = appendNodeFragment(json, { name, extensions: { KHR_audio_emitter: { emitter: emitterFragment.index } } }, opts);
    const combined = combineCommandParts([...generationFragments, sourceFragment, emitterFragment, usedFragment, nodeFragment]);
    return {
      index: nodeFragment.index,
      command: {
        id: makeCommandId("add-audio-emitter-node"),
        label: `Add audio emitter "${name}"`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /**
   * DOC-048 (M8 part 1): deletes `nodeIndex` AND its entire descendant
   * subtree (RECOMMENDED v1 policy — see this file's header; a future
   * "delete keeping children" variant is out of scope here) as ONE
   * combined, undoable command, fixing up every reference elsewhere in the
   * document that a shifted/removed node index would otherwise invalidate
   * (`referenceKindsForRemoval`'s doc comment enumerates exactly which).
   *
   * Implementation: the subtree's node indices are collected once, up front
   * (`collectSubtreeIndices`, against the pre-removal document — `children`
   * arrays are still intact at that point), then removed ONE AT A TIME in
   * DESCENDING index order. This ordering is what makes a multi-node
   * subtree deletion correct without any index-translation bookkeeping
   * across steps: removing the single largest remaining target index only
   * ever shifts indices ABOVE it, and by construction every other pending
   * target in this deletion is smaller — so no other pending target's
   * numeric value is ever invalidated by an earlier step in the loop. Each
   * individual step reads the CURRENT (progressively-patched) `json` to
   * compute its own fixup + removal, mirroring `GraphEdit.removeNode`'s
   * single-node "fixup patches before the remove op" ordering requirement
   * (`fixup-references.ts`'s own doc comment) — and every step's `{patches,
   * inverse}` is folded together via `combineCommandParts`, so undo unwinds
   * the whole multi-node deletion in the exact reverse order it was applied,
   * as one history entry.
   *
   * Returns `parentIndex`: the index the (former) parent of `nodeIndex`
   * will have AFTER this command applies (or `null` when `nodeIndex` was a
   * scene-root node, i.e. had no parent) — `specs/ux-scene-tree.md`'s
   * `UX-214` "selection moves to the parent" policy needs this, since the
   * parent's own index may itself have shifted down if any deleted subtree
   * member's original index was smaller than the parent's.
   */
  removeNode(document: EditorDocument, nodeIndex: number): { command: Command; parentIndex: number | null } {
    const nodesArray = getIn(document.json, ["nodes"]) as unknown[] | undefined;
    if (!nodesArray || nodesArray[nodeIndex] === undefined) {
      throw new Error(`SceneEdit.removeNode: no node at index ${nodeIndex}.`);
    }

    const originalParentIndex = findParentNodeIndex(document.json, nodeIndex);
    const subtree = collectSubtreeIndices(document.json, nodeIndex);
    const removalOrderDescending = subtree.slice().sort((a, b) => b - a);

    let json = document.json;
    const steps: PatchPair[] = [];
    for (const target of removalOrderDescending) {
      const refKinds = referenceKindsForRemoval(json, target);
      const fixup = fixupReferences(json, target, refKinds);
      const nodePath = ["nodes", target];
      const removeFragment: PatchPair = {
        patches: [{ op: "remove", path: formatPointer(nodePath) }],
        inverse: [{ op: "add", path: formatPointer(nodePath), value: getIn(json, nodePath) }]
      };
      // Fixups MUST run before the remove op — see fixup-references.ts's
      // "ORDERING REQUIREMENT": several of the fixup patches above address
      // OTHER array elements by their pre-this-removal position.
      const step = combineCommandParts([fixup, removeFragment]);
      steps.push(step);
      json = applyPatches(json, step.patches);
    }

    const combined = combineCommandParts(steps);
    const removedBelowParentCount = originalParentIndex === null ? 0 : subtree.filter((i) => i < originalParentIndex).length;
    const parentIndex = originalParentIndex === null ? null : originalParentIndex - removedBelowParentCount;

    const label = subtree.length > 1 ? `Delete ${subtree.length} nodes` : "Delete node";
    return {
      parentIndex,
      command: { id: makeCommandId("remove-node"), label, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /**
   * DOC-052 (M8 part 2): moves `nodeIndex` (and, implicitly, its entire
   * subtree — glTF's `children` arrays are the ONLY parent/child link, so
   * moving the subtree root necessarily carries every descendant with it,
   * with no work of its own required) from its current parent (or the
   * current default scene's root, when it has none) to `newParentIndex`
   * (or the scene root, when `null`), as ONE undoable command.
   *
   * Implementation is a plain two-array membership move: remove
   * `nodeIndex` from whichever array currently lists it
   * (`membershipArrayPath` of its CURRENT parent), then insert it into
   * `newParentIndex`'s array (or the scene root's) — at `insertIndex` when
   * given, else appended as the last child/root (mirroring `addNode`'s own
   * default landing spot for a brand new node, DOC-047). The insert step
   * is computed against `jsonAfterRemove` (not the original `document.json`)
   * specifically so reparenting a node to ANOTHER position among its OWN
   * current siblings (`newParentIndex === ` its current parent, a lightweight
   * sibling-reorder some future UI could build on `insertIndex` for) sees
   * its own removal already reflected before computing the insert index —
   * without this ordering, moving a node later within its own siblings list
   * would insert at an index still counting the node's own (soon-removed)
   * prior slot.
   *
   * NO other reference fixup is needed, and this is the crucial difference
   * from `removeNode`/`GraphEdit.removeNode`'s own reference-fixup passes
   * (DOC-019..021, DOC-048/049): reparenting never deletes a `nodes` array
   * element and never shifts any node's INDEX — `nodeIndex` keeps the exact
   * same value it had before this command, it merely changes which OTHER
   * array currently lists it as a member. Every existing reference to this
   * node elsewhere in the document — a `scenes[].nodes`/another node's
   * `children` entry (aside from the two membership arrays this command
   * itself edits), an `event/onSelect`/`onHoverIn`/`onHoverOut` handler's
   * `configuration.nodeIndex`, a `pointer/get|set|interpolate` node's
   * literal `configuration.pointer` string, an animation channel's
   * `target.node`, a `skins[].joints`/`skeleton` entry — addresses
   * `nodeIndex` by that same unchanged number and stays valid with zero
   * changes of its own. (Contrast `removeNode`, which deletes a `nodes`
   * array element outright and therefore MUST shift every reference above
   * the deleted index down by one via `fixupReferences`.)
   *
   * Rejects with a typed `CycleReparentError` — never partially applies
   * anything — when `newParentIndex` is `nodeIndex` itself or one of its
   * own descendants (`collectSubtreeIndices`), which would either
   * disconnect the moved subtree from the rest of the graph or create an
   * unwalkable cycle. Reparenting a node back under its OWN current parent
   * is explicitly allowed (not treated as a no-op-shaped error) — with no
   * `insertIndex`, that simply moves it to be the LAST child among its
   * current siblings, the same "moved to the end" semantics `addNode`
   * already established for a brand-new child landing under a selected
   * parent.
   *
   * WORLD-transform preservation is the DEFAULT (resolved here, not left
   * open — supersedes an earlier draft of this comment that argued for the
   * opposite default): a reparent is, from the user's point of view, a
   * PURELY STRUCTURAL move — "put this object under that other one" — not
   * an implicit "and also relocate it to wherever the new parent's local
   * space happens to put it" transform edit, so by default `reparentNode`
   * computes `nodeIndex`'s CURRENT world matrix (`worldMatrixOf`,
   * `mat-utils.ts`, walking the OLD parent chain) and solves for the new
   * LOCAL transform that reproduces that exact same world matrix under
   * `newParentIndex`'s own world matrix (`newLocal = inverse(newParentWorld)
   * * oldWorld`) — both matrices computed against the document as it stood
   * BEFORE this command's own membership-array edits, which is always valid
   * per this function's own cycle check above: `newParentIndex` can never be
   * one of `nodeIndex`'s own descendants, so `nodeIndex` can never be one of
   * `newParentIndex`'s ANCESTORS either, meaning removing `nodeIndex` from
   * its old membership array is provably incapable of changing
   * `newParentIndex`'s own world matrix. The result is written back in
   * whichever shape `nodeIndex` already authored its transform in — a
   * `matrix` array when it had one (glTF's `matrix`/TRS fields are mutually
   * exclusive, so there is no "both" case), else explicit `translation`/
   * `rotation`/`scale` fields, ALL THREE unconditionally (not just whichever
   * ones the node previously had set — a rotated/scaled ancestor chain can
   * turn a previously-identity component non-identity, so this can't reuse
   * `setTransform`'s narrower "only touch fields the caller named"
   * contract). `opts.keepLocal: true` opts OUT of all of this and restores
   * the simpler "local transform carries over completely unchanged, world
   * transform generally changes" behavior for a caller that genuinely wants
   * it (none currently does; the scene tree's drag-and-drop always wants the
   * default).
   *
   * `opts.insertIndex` (optional, formerly a bare positional parameter):
   * the index within the new membership array to insert at — omitted
   * appends as the LAST child, matching every other structural factory's
   * append-only default (DOC-047).
   */
  reparentNode(
    document: EditorDocument,
    nodeIndex: number,
    newParentIndex: number | null,
    insertIndex?: number,
    opts: { keepLocal?: boolean } = {}
  ): Command {
    const nodesArray = getIn(document.json, ["nodes"]) as unknown[] | undefined;
    if (!nodesArray || nodesArray[nodeIndex] === undefined) {
      throw new Error(`SceneEdit.reparentNode: no node at index ${nodeIndex}.`);
    }
    if (newParentIndex !== null && nodesArray[newParentIndex] === undefined) {
      throw new Error(`SceneEdit.reparentNode: no node at index ${newParentIndex}.`);
    }
    if (newParentIndex !== null) {
      const subtree = collectSubtreeIndices(document.json, nodeIndex);
      if (subtree.includes(newParentIndex)) {
        throw new CycleReparentError(nodeIndex, newParentIndex);
      }
    }

    const originalParentIndex = findParentNodeIndex(document.json, nodeIndex);
    const oldArrayPath = membershipArrayPath(document.json, originalParentIndex);
    const removeFragment = removeFromArrayFragment(document.json, oldArrayPath, nodeIndex);
    const jsonAfterRemove = applyPatches(document.json, removeFragment.patches);

    const newArrayPath = membershipArrayPath(jsonAfterRemove, newParentIndex);
    const insertFragment = insertIntoArrayFragment(jsonAfterRemove, newArrayPath, nodeIndex, insertIndex);

    const parts: PatchPair[] = [removeFragment, insertFragment];

    if (!opts.keepLocal) {
      // Both world matrices are computed against the ORIGINAL (pre-move)
      // `document.json` — see this function's own doc comment for why that's
      // always valid given the cycle check above already passed.
      const oldWorld = worldMatrixOf(document.json, nodeIndex);
      const newParentWorld = newParentIndex === null ? mat4Identity() : worldMatrixOf(document.json, newParentIndex);
      const invNewParentWorld = mat4Invert(newParentWorld);
      const newLocal = invNewParentWorld === null ? oldWorld : mat4Multiply(invNewParentWorld, oldWorld);
      parts.push(writeLocalMatrixFragment(document.json, nodeIndex, newLocal));
    }

    const combined = combineCommandParts(parts);
    return {
      id: makeCommandId("reparent-node"),
      label: `Reparent node ${nodeIndex}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * DOC-053 (M8 part 2): deep-copies `nodeIndex` AND its entire descendant
   * subtree (`collectSubtreeIndices`, the same DFS pre-order walk
   * `removeNode` uses) as brand-new, APPENDED `nodes` entries — append-only,
   * like `addNode`/`addPrimitiveMeshNode`/etc (DOC-046/047), never
   * reparenting or deleting anything that already exists — as ONE undoable
   * command. Returns `{command, index}` (mirroring every other structural
   * `SceneEdit` add factory's shape) where `index` is the NEW copy of
   * `nodeIndex` itself (the duplicated subtree's own root); a caller that
   * needs every duplicated descendant's new index too (none currently does)
   * can re-derive them from `index` via the same `collectSubtreeIndices`
   * walk against the post-command document.
   *
   * Sharing, not copying, every non-node resource reference: each
   * duplicated node object is a shallow copy of its original (`{...
   * original}`) with only its OWN `name` and `children` fields rewritten
   * (below) — `mesh`/`camera`/`extensions.KHR_lights_punctual.light`/
   * `extensions.KHR_audio_emitter.emitter`/`translation`/`rotation`/`scale`/
   * `matrix`/`weights`/every other field carries over completely unchanged,
   * still pointing at the exact same `meshes`/`cameras`/lights/emitters
   * registry entries the original node did. This is correct and cheap
   * because glTF already shares those registries by index — two `nodes`
   * entries referencing the same `mesh` index is exactly how instancing
   * works in this format, not a bug to work around — so `duplicateNode`
   * does not, and must not, also deep-copy `json.meshes`/`materials`/
   * `accessors`/etc; doing so would silently balloon a duplicate of a
   * heavy mesh into two full copies of its geometry for no benefit (editing
   * one duplicate's OWN node fields, e.g. `SceneEdit.setTransform`, never
   * touches the shared mesh data either way — only the two `nodes` array
   * entries ever diverge, exactly like duplicating any other node/instance
   * pair in this document model).
   *
   * `children` is remapped to the NEW indices of the duplicated
   * descendants — the copied subtree's own internal parent/child structure
   * is preserved intact, just entirely among the new indices, isomorphic to
   * the original subtree's shape — and OMITTED (not set to `[]`) on a
   * duplicated leaf, matching this codebase's established "no property, not
   * an empty array" convention (DOC-048/049/052). Every duplicated node's
   * `name` gets a `" copy"` suffix (defaulting to `Node {originalIndex}`
   * first when the original had no name, same fallback `flattenSceneTree`'s
   * own row-label logic uses) — applied to EVERY node in the copied
   * subtree, not just its root, so e.g. duplicating a rig's whole hand
   * doesn't leave five identically-named "Finger" children indistinguishable
   * from the original hand's own five in the scene tree.
   *
   * The new subtree root is spliced in as a SIBLING immediately after the
   * original — into the SAME membership array (`membershipArrayPath`) the
   * original currently belongs to, whether that's a parent's `children` or
   * the scene root's `nodes` — via the same `insertIntoArrayFragment`
   * `reparentNode` (DOC-052) uses, at `originalPosition + 1`. (Every OTHER
   * duplicated node is reachable purely through the new root's own
   * remapped `children` — nothing else needs a membership-array edit.)
   *
   * Deliberately NOT auto-wired into any interactivity graph: if the
   * duplicated subtree contains (or is itself) a node some graph handler
   * addresses — e.g. a `KHR_audio_emitter` emitter node with an
   * `event/onSelect` handler literally naming its ORIGINAL `nodeIndex` via
   * `configuration.nodeIndex` — the new copy's own index is NOT added to
   * that (or any) handler's configuration, and no new graph nodes are
   * created on its behalf. A duplicated "car pad" does not automatically
   * inherit the original's `onSelect` behavior; the user re-wires the copy
   * explicitly (dragging it onto the graph canvas per `specs/ux-scene-tree.
   * md`'s `UX-209`, or asking Copilot) exactly as if they'd built the new
   * node from scratch. This is the resolved policy choice, not an
   * oversight: auto-wiring would require this command to understand and
   * clone arbitrary graph-node subgraphs reachable from a handler, a
   * different (and open-ended) feature from "copy this node's OWN scene
   * data".
   */
  duplicateNode(document: EditorDocument, nodeIndex: number): { command: Command; index: number } {
    const nodesArray = getIn(document.json, ["nodes"]) as Array<Record<string, unknown> & { name?: string; children?: number[] }> | undefined;
    if (!nodesArray || nodesArray[nodeIndex] === undefined) {
      throw new Error(`SceneEdit.duplicateNode: no node at index ${nodeIndex}.`);
    }

    const subtree = collectSubtreeIndices(document.json, nodeIndex); // DFS pre-order; subtree[0] === nodeIndex.
    const baseIndex = nodesArray.length;
    const indexMap = new Map<number, number>();
    subtree.forEach((oldIndex, i) => indexMap.set(oldIndex, baseIndex + i));

    const addFragments: PatchPair[] = subtree.map((oldIndex, i) => {
      const original = nodesArray[oldIndex];
      const originalName = typeof original.name === "string" && original.name.length > 0 ? original.name : `Node ${oldIndex}`;
      const clone: Record<string, unknown> = { ...original, name: `${originalName} copy` };
      if (Array.isArray(original.children) && original.children.length > 0) {
        clone.children = original.children.map((childIndex) => indexMap.get(childIndex)!);
      } else {
        delete clone.children;
      }
      const pointer = formatPointer(["nodes", baseIndex + i]);
      return { patches: [{ op: "add", path: pointer, value: clone }], inverse: [{ op: "remove", path: pointer }] };
    });

    const jsonAfterNodes = applyPatches(document.json, addFragments.flatMap((f) => f.patches));

    const newRootIndex = indexMap.get(nodeIndex)!;
    const originalParentIndex = findParentNodeIndex(document.json, nodeIndex);
    const containerPath = membershipArrayPath(jsonAfterNodes, originalParentIndex);
    const containerArray = (getIn(jsonAfterNodes, containerPath.map(String)) as number[] | undefined) ?? [];
    const originalPosition = containerArray.indexOf(nodeIndex);
    const insertAt = originalPosition === -1 ? containerArray.length : originalPosition + 1;
    const insertFragment = insertIntoArrayFragment(jsonAfterNodes, containerPath, newRootIndex, insertAt);

    const combined = combineCommandParts([...addFragments, insertFragment]);
    const label = subtree.length > 1 ? `Duplicate node ${nodeIndex} (${subtree.length} nodes)` : `Duplicate node ${nodeIndex}`;
    return {
      index: newRootIndex,
      command: { id: makeCommandId("duplicate-node"), label, patches: combined.patches, inverse: combined.inverse }
    };
  },

  /**
   * DOC-066 (clip management): appends a NEW, self-contained bufferView-
   * embedded clip to the root `extensions.KHR_audio_emitter.audio[]`
   * registry — a fresh `buffers[]` entry holding `input.bytes` as a `data:`
   * URI (mirrors `addAudioEmitterNode`'s own `silentWavBuffer` embedding
   * shape, DOC-047) plus a `bufferViews[]` entry spanning it, scaffolding
   * `extensionsUsed` in the SAME combined command. The Assets > Audio Clips
   * tab's "Import" action: the caller (`packages/app`) has already
   * read+validated the file's bytes (via `AudioContext.decodeAudioData`)
   * before calling this — this factory only ever writes already-validated
   * bytes into the document; `editor-core` itself never does file I/O or
   * audio decoding.
   */
  addAudioClipEmbedded(document: EditorDocument, input: { bytes: Uint8Array; mimeType: string; name?: string }): { command: Command; index: number } {
    let json = document.json;
    const dataUri = `data:${input.mimeType};base64,${encodeBase64(input.bytes)}`;

    const bufferFragment = appendFragment(json, ["buffers"], { byteLength: input.bytes.byteLength, uri: dataUri });
    json = applyPatches(json, bufferFragment.patches);

    const bufferViewFragment = appendFragment(json, ["bufferViews"], { buffer: bufferFragment.index, byteOffset: 0, byteLength: input.bytes.byteLength });
    json = applyPatches(json, bufferViewFragment.patches);

    const audioEntry: Record<string, unknown> = { bufferView: bufferViewFragment.index, mimeType: input.mimeType };
    if (input.name) audioEntry.name = input.name;
    const audioFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "audio"], audioEntry);
    json = applyPatches(json, audioFragment.patches);

    const usedFragment = ensureExtensionUsedFragment(json, "KHR_audio_emitter");

    const combined = combineCommandParts([bufferFragment, bufferViewFragment, audioFragment, usedFragment]);
    return {
      index: audioFragment.index,
      command: {
        id: makeCommandId("add-audio-clip-embedded"),
        label: `Add audio clip${input.name ? ` "${input.name}"` : ""}`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /**
   * DOC-066: appends a URI-REFERENCED clip to `extensions.KHR_audio_emitter.
   * audio[]` — `input.uri` is kept VERBATIM in the JSON (never embedded/
   * base64'd), the "add by reference" path the Assets > Audio Clips tab
   * offers alongside `addAudioClipEmbedded`. Resolving `input.uri` to
   * playable bytes (relative to a granted project folder, or fetched over
   * http(s)) is entirely an app-layer/`WebAudioHost` concern — `editor-core`
   * never reads or validates the uri's target.
   */
  addAudioClipUri(document: EditorDocument, input: { uri: string; mimeType?: string; name?: string }): { command: Command; index: number } {
    const audioEntry: Record<string, unknown> = { uri: input.uri };
    if (input.mimeType) audioEntry.mimeType = input.mimeType;
    if (input.name) audioEntry.name = input.name;
    let json = document.json;
    const audioFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "audio"], audioEntry);
    json = applyPatches(json, audioFragment.patches);
    const usedFragment = ensureExtensionUsedFragment(json, "KHR_audio_emitter");
    const combined = combineCommandParts([audioFragment, usedFragment]);
    return {
      index: audioFragment.index,
      command: {
        id: makeCommandId("add-audio-clip-uri"),
        label: `Add audio clip reference${input.name ? ` "${input.name}"` : ""}`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /**
   * DOC-066: converts an EXISTING uri-referenced `audio[clipIndex]` entry in
   * place into a bufferView-embedded one — appends a fresh `buffers[]`+
   * `bufferViews[]` pair for `bytes` (same shape `addAudioClipEmbedded`
   * uses) and REPLACES the whole `audio[clipIndex]` element with
   * `{bufferView, mimeType, name?}` (dropping `uri` entirely), all as ONE
   * combined command. `clipIndex` itself never changes — every
   * `sources[].audio` reference elsewhere in the document keeps working
   * unmodified, unlike `removeAudioClip`, which shrinks the array. Throws
   * if `clipIndex` doesn't currently carry a `uri` (nothing to embed, or
   * already embedded) — the Assets tab only ever offers this action on a
   * referenced clip.
   */
  embedAudioClip(document: EditorDocument, clipIndex: number, bytes: Uint8Array, opts: { mimeType?: string } = {}): Command {
    const clip = getIn(document.json, ["extensions", "KHR_audio_emitter", "audio", clipIndex]) as Record<string, unknown> | undefined;
    if (!clip || typeof clip.uri !== "string") {
      throw new Error(`SceneEdit.embedAudioClip: audio clip #${clipIndex} has no uri to embed (already embedded, or doesn't exist).`);
    }
    let json = document.json;
    const mimeType = opts.mimeType ?? (typeof clip.mimeType === "string" ? clip.mimeType : "application/octet-stream");
    const dataUri = `data:${mimeType};base64,${encodeBase64(bytes)}`;

    const bufferFragment = appendFragment(json, ["buffers"], { byteLength: bytes.byteLength, uri: dataUri });
    json = applyPatches(json, bufferFragment.patches);

    const bufferViewFragment = appendFragment(json, ["bufferViews"], { buffer: bufferFragment.index, byteOffset: 0, byteLength: bytes.byteLength });
    json = applyPatches(json, bufferViewFragment.patches);

    const nextClip: Record<string, unknown> = { bufferView: bufferViewFragment.index, mimeType };
    if (typeof clip.name === "string") nextClip.name = clip.name;
    const clipFragment = setPathFragment(json, ["extensions", "KHR_audio_emitter", "audio", clipIndex], nextClip);

    const combined = combineCommandParts([bufferFragment, bufferViewFragment, clipFragment]);
    return { id: makeCommandId("embed-audio-clip"), label: `Embed audio clip #${clipIndex}`, patches: combined.patches, inverse: combined.inverse };
  },

  /**
   * DOC-066: removes `extensions.KHR_audio_emitter.audio[clipIndex]` —
   * BLOCKED (throws `AudioClipInUseError`, carrying an exact `usageCount`)
   * when any `sources[]` entry still references it via `audio === clipIndex`
   * (`countAudioClipUsage`), mirroring `GraphEdit.removeVariable`'s
   * block-don't-dangle policy (DOC-055). When unused, removes the element
   * AND shifts every surviving `sources[].audio` reference above it down by
   * one, as ONE combined command — this extension's `audio[]` table has no
   * existing shared fixup path (same as `variables[]`/`events[]` before it),
   * so this factory owns its own narrow shift logic rather than extending
   * `fixup-references.ts`.
   */
  removeAudioClip(document: EditorDocument, clipIndex: number): Command {
    const audio = (getIn(document.json, ["extensions", "KHR_audio_emitter", "audio"]) as Array<Record<string, unknown>> | undefined) ?? [];
    const clip = audio[clipIndex];
    if (!clip) {
      throw new Error(`SceneEdit.removeAudioClip: no audio clip at index ${clipIndex}.`);
    }
    const usageCount = countAudioClipUsage(document.json, clipIndex);
    if (usageCount > 0) {
      throw new AudioClipInUseError(clipIndex, usageCount, typeof clip.name === "string" ? clip.name : undefined);
    }

    const sources = (getIn(document.json, ["extensions", "KHR_audio_emitter", "sources"]) as Array<Record<string, unknown>> | undefined) ?? [];
    const sourcesPath = ["extensions", "KHR_audio_emitter", "sources"];
    let sourcesChanged = false;
    const nextSources = sources.map((source) => {
      if (typeof source.audio === "number" && source.audio > clipIndex) {
        sourcesChanged = true;
        return { ...source, audio: source.audio - 1 };
      }
      return source;
    });
    const sourcesFragment: PatchPair = sourcesChanged
      ? { patches: [{ op: "replace", path: formatPointer(sourcesPath), value: nextSources }], inverse: [{ op: "replace", path: formatPointer(sourcesPath), value: sources }] }
      : { patches: [], inverse: [] };

    const audioPath = ["extensions", "KHR_audio_emitter", "audio"];
    const nextAudio = [...audio.slice(0, clipIndex), ...audio.slice(clipIndex + 1)];
    const removeFragment: PatchPair = {
      patches: [{ op: "replace", path: formatPointer(audioPath), value: nextAudio }],
      inverse: [{ op: "replace", path: formatPointer(audioPath), value: audio }]
    };

    const combined = combineCommandParts([sourcesFragment, removeFragment]);
    return {
      id: makeCommandId("remove-audio-clip"),
      label: `Remove audio clip${typeof clip.name === "string" ? ` "${clip.name}"` : ` #${clipIndex}`}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * DOC-066 (source lifecycle): appends a NEW `sources[]` entry — bound to
   * `opts.audioIndex` when given (a Clip-mode source, `gain:1, loop:false,
   * autoplay:false`, mirroring `addAudioEmitterNode`'s own default source
   * shape), else an Oscillator-mode source (`opts.oscillator`'s payload,
   * defaulting to a plain sine — the full default-params table is an
   * app/`audio-canvas` concern `editor-core` doesn't import) — and appends
   * its index into `emitters[emitterIndex].sources`, as ONE combined
   * command. The Inspector's Sources sub-list "+ Add source" action.
   */
  addSourceToEmitter(
    document: EditorDocument,
    emitterIndex: number,
    opts: { audioIndex?: number; oscillator?: Record<string, unknown> } = {}
  ): { command: Command; index: number } {
    const emitter = getIn(document.json, ["extensions", "KHR_audio_emitter", "emitters", emitterIndex]);
    if (!emitter) {
      throw new Error(`SceneEdit.addSourceToEmitter: no emitter at index ${emitterIndex}.`);
    }
    let json = document.json;
    const sourceValue: Record<string, unknown> =
      opts.audioIndex !== undefined
        ? { audio: opts.audioIndex, gain: 1, loop: false, autoplay: false }
        : { gain: 1, autoplay: false, extensions: { KHR_audio_graph: { oscillator: opts.oscillator ?? { type: "sine", frequency: 440, detune: 0 } } } };

    const sourceFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "sources"], sourceValue);
    json = applyPatches(json, sourceFragment.patches);

    const sourcesArrayFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "emitters", emitterIndex, "sources"], sourceFragment.index);

    const combined = combineCommandParts([sourceFragment, sourcesArrayFragment]);
    return {
      index: sourceFragment.index,
      command: {
        id: makeCommandId("add-source-to-emitter"),
        label: `Add source to emitter ${emitterIndex}`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /**
   * DOC-066: removes `sourceIndex` from `emitters[emitterIndex].sources` —
   * membership-array removal only (mirrors `SceneEdit`'s node-membership
   * factories' own "orphan, don't garbage-collect" philosophy, DOC-050): the
   * underlying `sources[sourceIndex]` registry entry and whatever clip it
   * references are left completely untouched (another emitter, or this same
   * one via a second slot, may still reference that exact source index) —
   * safe to call with no usage-blocking check, unlike `removeAudioClip`.
   */
  removeSourceFromEmitter(document: EditorDocument, emitterIndex: number, sourceIndex: number): Command {
    const emitter = getIn(document.json, ["extensions", "KHR_audio_emitter", "emitters", emitterIndex]) as { sources?: number[] } | undefined;
    const list = emitter?.sources ?? [];
    const position = list.indexOf(sourceIndex);
    if (position === -1) {
      throw new Error(`SceneEdit.removeSourceFromEmitter: emitter ${emitterIndex} does not reference source ${sourceIndex}.`);
    }
    const path = ["extensions", "KHR_audio_emitter", "emitters", emitterIndex, "sources"];
    const nextList = [...list.slice(0, position), ...list.slice(position + 1)];
    return {
      id: makeCommandId("remove-source-from-emitter"),
      label: `Remove source from emitter ${emitterIndex}`,
      patches: [{ op: "replace", path: formatPointer(path), value: nextList }],
      inverse: [{ op: "replace", path: formatPointer(path), value: list }]
    };
  },

  /**
   * DOC-066 (multi-emitter-per-node, closing PR #48's documented gap): adds
   * ANOTHER `KHR_audio_emitter` binding to a node that may already carry
   * one — builds a full source+positional-emitter chain (identical shape to
   * `addAudioEmitterNode`'s own generation, reusing `opts.audioIndex` the
   * same way when given), then binds it onto `nodeIndex` under whichever
   * field shape is already in play: a node with NO existing binding gets
   * the singular `extensions.KHR_audio_emitter.emitter` field (unchanged
   * behavior for the common single-emitter case — no `.emitters` array is
   * introduced unless/until a SECOND emitter actually needs one); a node
   * that already has a singular `.emitter` is upgraded to the array-valued
   * `.emitters` field (the existing binding becomes `.emitters[0]`, the new
   * one `.emitters[1]`); a node that already has `.emitters` simply
   * appends. `WebAudioHost` already reads BOTH shapes interchangeably
   * (`web-audio-host.ts`'s `Array.isArray(ext.emitters) ? ext.emitters :
   * ... [ext.emitter]` fallback) — this factory is purely the
   * authoring-side gap the Inspector's single-`emitterIndex` lookup left
   * closed until now.
   */
  addEmitterToNode(document: EditorDocument, nodeIndex: number, opts: { audioIndex?: number } = {}): { command: Command; emitterIndex: number } {
    const node = getIn(document.json, ["nodes", nodeIndex]) as Record<string, unknown> | undefined;
    if (!node) {
      throw new Error(`SceneEdit.addEmitterToNode: no node at index ${nodeIndex}.`);
    }
    let json = document.json;
    const generationFragments: PatchPair[] = [];
    let audioIndex = opts.audioIndex;

    if (audioIndex === undefined) {
      const wav = silentWavBuffer();
      const bufferFragment = appendFragment(json, ["buffers"], { byteLength: wav.byteLength, uri: wav.uri });
      json = applyPatches(json, bufferFragment.patches);
      generationFragments.push(bufferFragment);

      const bufferViewFragment = appendFragment(json, ["bufferViews"], { buffer: bufferFragment.index, byteOffset: 0, byteLength: wav.byteLength });
      json = applyPatches(json, bufferViewFragment.patches);
      generationFragments.push(bufferViewFragment);

      const audioFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "audio"], { bufferView: bufferViewFragment.index, mimeType: "audio/wav" });
      json = applyPatches(json, audioFragment.patches);
      generationFragments.push(audioFragment);
      audioIndex = audioFragment.index;
    }

    const sourceFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "sources"], { audio: audioIndex, gain: 1, loop: false, autoplay: false });
    json = applyPatches(json, sourceFragment.patches);

    const emitterFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "emitters"], {
      type: "positional",
      gain: 1,
      sources: [sourceFragment.index],
      positional: { shapeType: "omnidirectional", distanceModel: "inverse", refDistance: 1, maxDistance: 0, rolloffFactor: 1 }
    });
    json = applyPatches(json, emitterFragment.patches);

    const usedFragment = ensureExtensionUsedFragment(json, "KHR_audio_emitter");
    json = applyPatches(json, usedFragment.patches);

    const existingExt = (node.extensions as Record<string, unknown> | undefined)?.KHR_audio_emitter as { emitter?: number; emitters?: number[] } | undefined;
    let bindFragment: PatchPair;
    if (!existingExt || (existingExt.emitter === undefined && existingExt.emitters === undefined)) {
      bindFragment = setPathFragment(json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitter"], emitterFragment.index);
    } else if (Array.isArray(existingExt.emitters)) {
      bindFragment = setPathFragment(json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitters"], [...existingExt.emitters, emitterFragment.index]);
    } else {
      // Upgrade singular `.emitter` to array-valued `.emitters`, dropping `.emitter`.
      const upgraded = setPathFragment(json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitters"], [existingExt.emitter, emitterFragment.index]);
      const afterUpgrade = applyPatches(json, upgraded.patches);
      const dropSingular = deletePathFragment(afterUpgrade, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitter"]);
      bindFragment = combineCommandParts([upgraded, dropSingular]);
    }

    const combined = combineCommandParts([...generationFragments, sourceFragment, emitterFragment, usedFragment, bindFragment]);
    return {
      emitterIndex: emitterFragment.index,
      command: {
        id: makeCommandId("add-emitter-to-node"),
        label: `Add audio emitter to node ${nodeIndex}`,
        patches: combined.patches,
        inverse: combined.inverse
      }
    };
  },

  /**
   * DOC-066: removes ONE `KHR_audio_emitter` binding from `nodeIndex` — the
   * counterpart to `addEmitterToNode`. When the node's binding is the
   * singular `.emitter` field, it's deleted outright (leaving the node
   * audio-less). When it's array-valued `.emitters`, `emitterIndex` is
   * spliced out of that array (never collapsed back down to a singular
   * `.emitter` field, even when exactly one remains — `WebAudioHost` reads
   * a one-element `.emitters` array identically to a singular `.emitter`).
   * Mirrors `removeSourceFromEmitter`'s own orphan-don't-garbage-collect
   * policy (DOC-050): the underlying `emitters[]`/`sources[]`/`audio[]`
   * registry entries this binding pointed at are left completely untouched.
   */
  removeEmitterFromNode(document: EditorDocument, nodeIndex: number, emitterIndex: number): Command {
    const node = getIn(document.json, ["nodes", nodeIndex]) as Record<string, unknown> | undefined;
    const ext = (node?.extensions as Record<string, unknown> | undefined)?.KHR_audio_emitter as { emitter?: number; emitters?: number[] } | undefined;
    if (!ext) {
      throw new Error(`SceneEdit.removeEmitterFromNode: node ${nodeIndex} has no KHR_audio_emitter binding.`);
    }
    if (Array.isArray(ext.emitters)) {
      const position = ext.emitters.indexOf(emitterIndex);
      if (position === -1) {
        throw new Error(`SceneEdit.removeEmitterFromNode: node ${nodeIndex} does not reference emitter ${emitterIndex}.`);
      }
      const path = ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitters"];
      const nextList = [...ext.emitters.slice(0, position), ...ext.emitters.slice(position + 1)];
      return {
        id: makeCommandId("remove-emitter-from-node"),
        label: `Remove audio emitter from node ${nodeIndex}`,
        patches: [{ op: "replace", path: formatPointer(path), value: nextList }],
        inverse: [{ op: "replace", path: formatPointer(path), value: ext.emitters }]
      };
    }
    if (ext.emitter !== emitterIndex) {
      throw new Error(`SceneEdit.removeEmitterFromNode: node ${nodeIndex} does not reference emitter ${emitterIndex}.`);
    }
    const fragment = deletePathFragment(document.json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter", "emitter"]);
    return {
      id: makeCommandId("remove-emitter-from-node"),
      label: `Remove audio emitter from node ${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  }
};

/**
 * DOC-052: a node's LOCAL matrix — `node.matrix` verbatim when present
 * (glTF's `matrix`/TRS fields are mutually exclusive), else composed from
 * `translation`/`rotation`/`scale` (each defaulting per the glTF spec:
 * `[0,0,0]`/`[0,0,0,1]`/`[1,1,1]`) via `mat-utils.ts`'s
 * `mat4FromTranslationRotationScale`.
 */
function localMatrixOf(json: unknown, nodeIndex: number): Mat4 {
  const node = getIn(json, ["nodes", nodeIndex]) as { matrix?: number[]; translation?: Vec3; rotation?: Quat; scale?: Vec3 } | undefined;
  if (node?.matrix) return Float32Array.from(node.matrix);
  return mat4FromTranslationRotationScale(node?.translation ?? [0, 0, 0], node?.rotation ?? [0, 0, 0, 1], node?.scale ?? [1, 1, 1]);
}

/**
 * DOC-052: `nodeIndex`'s WORLD matrix — the product of every ancestor's
 * local matrix (root-most first) down through `nodeIndex`'s own, walking
 * the CURRENT parent chain via `findParentNodeIndex` (glTF's node graph is
 * a forest — at most one parent per node, so this walk is unambiguous and
 * always terminates at a root).
 */
function worldMatrixOf(json: unknown, nodeIndex: number): Mat4 {
  const chain: number[] = [];
  let cursor: number | null = nodeIndex;
  while (cursor !== null) {
    chain.push(cursor);
    cursor = findParentNodeIndex(json, cursor);
  }
  chain.reverse(); // root-most ancestor first, nodeIndex itself last.
  let acc = mat4Identity();
  for (const index of chain) {
    acc = mat4Multiply(acc, localMatrixOf(json, index));
  }
  return acc;
}

/**
 * DOC-052: writes `newLocal` back to `nodeIndex` in whichever shape it
 * already authored its own transform in — a `matrix` array when it had one,
 * else explicit `translation`/`rotation`/`scale` fields (all three,
 * unconditionally — see `reparentNode`'s own doc comment for why this can't
 * reuse `setTransform`'s narrower "only fields the caller named" contract).
 */
function writeLocalMatrixFragment(json: unknown, nodeIndex: number, newLocal: Mat4): PatchPair {
  const node = getIn(json, ["nodes", nodeIndex]) as { matrix?: number[] } | undefined;
  if (node?.matrix) {
    return setPathFragment(json, ["nodes", nodeIndex, "matrix"], Array.from(newLocal));
  }
  const { translation, rotation, scale } = mat4Decompose(newLocal);
  const translationFragment = setPathFragment(json, ["nodes", nodeIndex, "translation"], translation);
  const jsonAfterTranslation = applyPatches(json, translationFragment.patches);
  const rotationFragment = setPathFragment(jsonAfterTranslation, ["nodes", nodeIndex, "rotation"], rotation);
  const jsonAfterRotation = applyPatches(jsonAfterTranslation, rotationFragment.patches);
  const scaleFragment = setPathFragment(jsonAfterRotation, ["nodes", nodeIndex, "scale"], scale);
  return combineCommandParts([translationFragment, rotationFragment, scaleFragment]);
}
