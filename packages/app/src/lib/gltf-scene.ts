// Derives the scene-tree hierarchy (specs/ux-scene-tree.md UX-200..204) from
// an EditorDocument's raw glTF `json` — no separate hand-authored copy of
// the hierarchy, so it can't drift from the document.
// "clip" is not produced by `flattenSceneTree`/`iconForNode` (there's no
// scene-tree row for an animation clip) — it's here only so
// PointerPickerDialog's content tree (specs/ux-pointer-picker.md's UX-901
// Animations section) can reuse the same `NodeIcon` component/icon set as
// the Nodes/Materials sections instead of hand-rolling a fourth icon set.
export type NodeIconType = "mesh" | "light" | "camera" | "audio-emitter" | "group" | "clip";

export interface GltfNodeJson {
  name?: string;
  mesh?: number;
  camera?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  weights?: number[];
  extensions?: {
    /**
     * Multi-emitter-per-node: `emitter` is the original singular binding;
     * `emitters` is the array-valued shape `SceneEdit.addEmitterToNode`
     * introduces once a node carries a SECOND emitter (a real imported
     * asset, e.g. the lifted gltf-webgpu `drum-pads` sample, may also author
     * `emitters` directly). Never both at once — see that factory's own doc
     * comment for the upgrade-on-second-add policy.
     */
    KHR_audio_emitter?: { emitter?: number; emitters?: number[] };
    KHR_lights_punctual?: { light: number };
    /**
     * Emitter/environment authoring (specs/ux-inspector.md UX-421/UX-422):
     * the ONE JSON location the real extension overloads for two purposes
     * on a node — a reverb ZONE binding (`environment`/`shape`/
     * `blendDistance`/`priority`) or a LISTENER binding (`listener`,
     * typically on a camera node) — see `SceneEdit.
     * setNodeAudioEnvironmentProperty`'s own doc comment.
     */
    KHR_audio_environment?: {
      listener?: number;
      environment?: number;
      shape?: { type: "sphere" | "box" | string; size?: [number, number, number]; radius?: number };
      blendDistance?: number;
      priority?: number;
    };
    [key: string]: unknown;
  };
}

export interface GltfPrimitiveJson {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: Array<Record<string, number>>;
}

export interface GltfMeshJson {
  name?: string;
  primitives: GltfPrimitiveJson[];
}

export interface GltfAccessorJson {
  type: string;
  componentType: number;
  count: number;
}

/** A material's texture-info reference (specs/ux-inspector.md UX-416): `index` is a `textures[]` index, resolving (via `textures[index].source`) to an `images[]` entry. */
export interface GltfTextureInfoJson {
  index: number;
  texCoord?: number;
  scale?: number; // normalTexture only.
  strength?: number; // occlusionTexture only.
  extensions?: { KHR_texture_transform?: GltfTextureTransformJson; [key: string]: unknown };
}

export interface GltfTextureTransformJson {
  offset?: [number, number];
  scale?: [number, number];
  rotation?: number;
  texCoord?: number;
}

export interface GltfMaterialJson {
  name?: string;
  doubleSided?: boolean;
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  emissiveFactor?: [number, number, number];
  normalTexture?: GltfTextureInfoJson;
  occlusionTexture?: GltfTextureInfoJson;
  emissiveTexture?: GltfTextureInfoJson;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: GltfTextureInfoJson;
    metallicRoughnessTexture?: GltfTextureInfoJson;
    metallicFactor?: number;
    roughnessFactor?: number;
  };
}

export interface GltfTextureJson {
  source?: number;
  sampler?: number;
}

export interface GltfImageJson {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

/** `source.extensions.KHR_audio_graph.oscillator` (r2): present only on a source with no `audio` index — the waveform payload for an oscillator source, authored via the Sources sub-list's Oscillator mode (specs/ux-inspector.md UX-420) instead of `audio-canvas`'s node palette (r2 removed `oscillator` as a graph node kind entirely). */
export interface GltfAudioSourceOscillatorJson {
  type?: string;
  frequency?: number;
  detune?: number;
  pulseWidth?: number;
  periodicWave?: { real: number[]; imag: number[] };
}

/** `extensions.KHR_audio_emitter.sources[N]` — either a playable clip binding (`audio` set) or, per r2, an oscillator source (`audio` absent, `extensions.KHR_audio_graph.oscillator` set) (specs/ux-inspector.md UX-420), addressed by SOURCE index (an emitter only stores `sources: number[]` indices into this array, never the objects themselves). */
export interface GltfAudioSourceJson {
  name?: string;
  audio?: number;
  gain?: number;
  playbackRate?: number;
  loop?: boolean;
  autoplay?: boolean;
  extensions?: { KHR_audio_graph?: { oscillator?: GltfAudioSourceOscillatorJson } };
}

/** `extensions.KHR_audio_emitter.audio[N]` — a raw clip reference (bufferView-embedded or `data:`/external URI), read-only in this Inspector (specs/ux-inspector.md UX-420's "no clip replacement/upload" scope, mirroring UX-416's texture-slot precedent). */
export interface GltfAudioDataJson {
  name?: string;
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

/** `extensions.KHR_audio_emitter.emitters[N]`'s own `positional` sub-object (specs/ux-inspector.md UX-419) — present only when `type === "positional"`. */
export interface GltfAudioPositionalJson {
  shapeType?: "omnidirectional" | "cone" | string;
  distanceModel?: "linear" | "inverse" | "exponential" | "custom" | string;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
}

export interface GltfAudioEmitterJson {
  name?: string;
  type?: "global" | "positional" | string;
  gain?: number;
  sources?: number[];
  positional?: GltfAudioPositionalJson;
  /** @deprecated top-level `distanceModel` is never read by `WebAudioHost` (only `positional.distanceModel` is) — kept typed here only so an IMPORTED asset that mistakenly carries one (or one authored by this app before UX-419's bugfix) still round-trips; the Inspector never writes here anymore. */
  distanceModel?: string;
  extensions?: { KHR_audio_environment?: { directLevel?: number; reverbLevel?: number; environment?: number } };
}

/** `extensions.KHR_audio_environment.environments[N]` (specs/ux-inspector.md UX-421) — a reverb zone definition, addressed by ENVIRONMENT index. */
export interface GltfAudioEnvironmentJson {
  name?: string;
  reverb?: { preset?: string; mix?: number };
  doppler?: { enabled?: boolean; scale?: number; speedOfSound?: number };
}

/** `extensions.KHR_audio_environment.listeners[N]` (specs/ux-inspector.md UX-422), addressed by LISTENER index. */
export interface GltfAudioListenerJson {
  name?: string;
  gain?: number;
  spatializationModel?: "HRTF" | "equalpower" | string;
}

/** A `KHR_lights_punctual` root registry entry (specs/ux-inspector.md UX-417) — `extensions.KHR_lights_punctual.lights[N]`, addressed by LIGHT index, not node index (a node references one via `node.extensions.KHR_lights_punctual.light`). */
export interface GltfLightJson {
  name?: string;
  type?: "directional" | "point" | "spot";
  color?: [number, number, number];
  intensity?: number;
  range?: number; // point/spot only — meaningless for directional (glTF spec).
  spot?: { innerConeAngle?: number; outerConeAngle?: number }; // spot only.
}

/** Core glTF `cameras[N]` (specs/ux-inspector.md UX-418) — referenced by a node via `node.camera`. Only `perspective` is modeled (this app's own `SceneEdit.addCameraNode` never authors an orthographic camera, and the Inspector's Camera section only edits perspective fields). */
export interface GltfCameraJson {
  name?: string;
  type?: "perspective" | "orthographic";
  perspective?: { yfov: number; znear: number; zfar?: number; aspectRatio?: number };
}

export interface GltfJsonShape {
  scene?: number;
  scenes?: Array<{
    nodes?: number[];
    name?: string;
    extensions?: { KHR_audio_environment?: { environment?: number; activeListener?: number } };
  }>;
  nodes?: GltfNodeJson[];
  meshes?: GltfMeshJson[];
  materials?: GltfMaterialJson[];
  cameras?: GltfCameraJson[];
  textures?: GltfTextureJson[];
  images?: GltfImageJson[];
  accessors?: GltfAccessorJson[];
  /** Core glTF `bufferViews[]` — added for `audio-clip-bytes.ts`'s embedded-clip byte resolution (Assets > Audio Clips tab); not otherwise read anywhere in this file. */
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
  /** Core glTF `buffers[]` — see `bufferViews` above. */
  buffers?: Array<{ uri?: string; byteLength: number }>;
  animations?: Array<{ name?: string }>;
  extensions?: {
    KHR_audio_emitter?: { emitters?: GltfAudioEmitterJson[]; sources?: GltfAudioSourceJson[]; audio?: GltfAudioDataJson[] };
    KHR_audio_environment?: { environments?: GltfAudioEnvironmentJson[]; listeners?: GltfAudioListenerJson[] };
    KHR_lights_punctual?: { lights?: GltfLightJson[] };
    [key: string]: unknown;
  };
}

export interface SceneTreeRow {
  nodeIndex: number;
  name: string;
  depth: number;
  icon: NodeIconType;
  hasChildren: boolean;
}

export function iconForNode(node: GltfNodeJson | undefined): NodeIconType {
  if (!node) return "group";
  if (node.camera !== undefined) return "camera";
  if (node.mesh !== undefined) return "mesh";
  const ext = node.extensions ?? {};
  if ("KHR_audio_emitter" in ext) return "audio-emitter";
  if ("KHR_lights_punctual" in ext) return "light";
  return "group";
}

/**
 * Full punctual-light control (specs/render-host.md RH-032): every node
 * index whose glTF entry carries `extensions.KHR_lights_punctual.light` —
 * the "all lights" viewport toolbar toggle's own `EditorHelperDescriptor`
 * list (`Viewport.tsx`) enumerates these directly rather than re-deriving
 * them from `flattenSceneTree`'s row list, since a light helper is wanted
 * for every light NODE regardless of scene-tree collapse state.
 */
export function lightNodeIndices(json: GltfJsonShape | undefined): number[] {
  const nodes = json?.nodes ?? [];
  const indices: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]?.extensions?.KHR_lights_punctual?.light !== undefined) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Flattens the default scene's node graph into a depth-first row list
 * (UX-200): each row knows its depth (for 16px/level indent) and whether it
 * has children (for the twisty vs. spacer, UX-200). Does not itself apply
 * collapse state — see `visibleRows` below (UX-201).
 */
export function flattenSceneTree(json: GltfJsonShape | undefined): SceneTreeRow[] {
  if (!json) return [];
  const nodes = json.nodes ?? [];
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? [];
  const rows: SceneTreeRow[] = [];
  const visited = new Set<number>();

  function visit(nodeIndex: number, depth: number): void {
    if (visited.has(nodeIndex)) return; // guards against a malformed cyclic graph
    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    const children = node?.children ?? [];
    rows.push({
      nodeIndex,
      name: node?.name && node.name.length > 0 ? node.name : `Node ${nodeIndex}`,
      depth,
      icon: iconForNode(node),
      hasChildren: children.length > 0
    });
    for (const child of children) visit(child, depth + 1);
  }

  for (const rootIndex of roots) visit(rootIndex, 0);
  return rows;
}

/**
 * specs/ux-scene-tree.md UX-214: the number of nodes `SceneEdit.removeNode`
 * would delete for `nodeIndex` — itself plus every descendant reachable via
 * `children` (DOC-048's whole-subtree-as-one-command policy) — so the
 * context menu's "Delete" label can say "Delete (3 nodes)" rather than a
 * plain "Delete" when there are children involved. Cycle-guarded the same
 * way `flattenSceneTree` is, for a malformed cyclic graph.
 */
export function countSubtreeNodes(json: GltfJsonShape | undefined, nodeIndex: number): number {
  const nodes = json?.nodes ?? [];
  const visited = new Set<number>();
  function visit(index: number): void {
    if (visited.has(index)) return;
    visited.add(index);
    for (const child of nodes[index]?.children ?? []) visit(child);
  }
  visit(nodeIndex);
  return visited.size;
}

/**
 * UX-201: hides every row whose ancestor chain includes a collapsed node.
 * `rows` is depth-first order, so a single "currently hiding everything
 * deeper than this depth" cursor suffices — nested collapsed subtrees
 * within an already-hidden range don't need their own tracking, and a
 * sibling at the same depth as the collapsed node correctly re-appears
 * (depth equality ends the hidden range before that sibling is examined).
 */
export function visibleRows(rows: SceneTreeRow[], collapsed: ReadonlySet<number>): SceneTreeRow[] {
  const result: SceneTreeRow[] = [];
  let hideBelowDepth: number | null = null;

  for (const row of rows) {
    if (hideBelowDepth !== null) {
      if (row.depth > hideBelowDepth) continue;
      hideBelowDepth = null;
    }
    result.push(row);
    if (row.hasChildren && collapsed.has(row.nodeIndex)) {
      hideBelowDepth = row.depth;
    }
  }
  return result;
}
