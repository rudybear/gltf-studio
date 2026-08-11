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
// `configuration.nodeIndex`). `reparentNode` remains the throwing M8 stub —
// reparenting an EXISTING node (as opposed to `addNode`'s append-only
// `parentNodeIndex` landing spot for a BRAND NEW node) is still deferred.
import type { Command } from "./command.js";
import { combineCommandParts, makeCommandId } from "./command.js";
import { appendFragment, setPathFragment, type PatchPair } from "./edit-fragments.js";
import { fixupReferences, type ReferenceKind } from "./fixup-references.js";
import { formatPointer, getIn } from "./json-pointer.js";
import { applyPatches } from "./patch.js";
import type { EditorDocument } from "./document.js";
import { cubeGeometry, sphereGeometry, planeGeometry, encodeCubeBuffer, silentWavBuffer, type CubeGeometry } from "./primitives.js";

export class SceneEditNotImplementedError extends Error {
  constructor(operation: string) {
    super(`SceneEdit.${operation} is not implemented in M1 — structural scene editing is deferred to milestone M8.`);
    this.name = "SceneEditNotImplementedError";
  }
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
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206): the scene tree's
   * "+ Add" > Light entry. Appends a `KHR_lights_punctual` light (default: a
   * point light) to `extensions.KHR_lights_punctual.lights`, scaffolding
   * the extension + its `extensionsUsed` entry when neither exists yet
   * (mirroring `GraphEdit.ensureGraph`'s, DOC-041, find-or-scaffold
   * pattern for `KHR_interactivity`), plus a node referencing it via
   * `node.extensions.KHR_lights_punctual.light` — all as ONE combined
   * command. Lands under `opts.parentNodeIndex` when given, else scene root.
   */
  addLightNode(document: EditorDocument, name: string, opts: { parentNodeIndex?: number; light?: Record<string, unknown> } = {}): { command: Command; index: number } {
    const lightDef = opts.light ?? { type: "point" };
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
   * DOC-047 (M8-lite, specs/ux-scene-tree.md UX-206): the scene tree's
   * "+ Add" > Audio Emitter entry. Builds a complete, immediately-
   * auditionable `KHR_audio_emitter` chain from scratch — a silent WAV
   * buffer (`primitives.ts`'s `silentWavBuffer`; see its own doc comment
   * for why a clip is generated at all rather than leaving `sources`
   * empty) + bufferView + `audio[]` entry + `sources[]` entry + a
   * positional `emitters[]` entry, scaffolding the extension's
   * `extensionsUsed` entry when needed — plus a node referencing the new
   * emitter via `node.extensions.KHR_audio_emitter.emitter`, all as ONE
   * combined command. Lands under `opts.parentNodeIndex` when given, else
   * scene root.
   */
  addAudioEmitterNode(document: EditorDocument, name: string, opts: { parentNodeIndex?: number } = {}): { command: Command; index: number } {
    const wav = silentWavBuffer();

    const bufferFragment = appendFragment(document.json, ["buffers"], { byteLength: wav.byteLength, uri: wav.uri });
    let json = applyPatches(document.json, bufferFragment.patches);

    const bufferViewFragment = appendFragment(json, ["bufferViews"], { buffer: bufferFragment.index, byteOffset: 0, byteLength: wav.byteLength });
    json = applyPatches(json, bufferViewFragment.patches);

    const audioFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "audio"], { bufferView: bufferViewFragment.index, mimeType: "audio/wav" });
    json = applyPatches(json, audioFragment.patches);

    const sourceFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "sources"], {
      audio: audioFragment.index,
      gain: 1,
      loop: false,
      autoplay: false
    });
    json = applyPatches(json, sourceFragment.patches);

    const emitterFragment = appendFragment(json, ["extensions", "KHR_audio_emitter", "emitters"], {
      type: "positional",
      gain: 1,
      sources: [sourceFragment.index]
    });
    json = applyPatches(json, emitterFragment.patches);

    const usedFragment = ensureExtensionUsedFragment(json, "KHR_audio_emitter");
    json = applyPatches(json, usedFragment.patches);

    const nodeFragment = appendNodeFragment(json, { name, extensions: { KHR_audio_emitter: { emitter: emitterFragment.index } } }, opts);
    const combined = combineCommandParts([bufferFragment, bufferViewFragment, audioFragment, sourceFragment, emitterFragment, usedFragment, nodeFragment]);
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

  /** STUB (M8 part 2): structural node reparenting — moving an EXISTING node under a different existing parent. Still deferred; `addNode`'s append-only `parentNodeIndex` (DOC-047) and `removeNode`'s whole-subtree deletion (DOC-048) do not need it. */
  reparentNode(): never {
    throw new SceneEditNotImplementedError("reparentNode");
  }
};
