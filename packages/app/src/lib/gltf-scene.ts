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
    KHR_audio_emitter?: { emitter: number };
    KHR_lights_punctual?: { light: number };
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

export interface GltfMaterialJson {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
}

export interface GltfAudioEmitterJson {
  type?: string;
  gain?: number;
  distanceModel?: string;
}

export interface GltfJsonShape {
  scene?: number;
  scenes?: Array<{ nodes?: number[]; name?: string }>;
  nodes?: GltfNodeJson[];
  meshes?: GltfMeshJson[];
  materials?: GltfMaterialJson[];
  accessors?: GltfAccessorJson[];
  animations?: Array<{ name?: string }>;
  extensions?: {
    KHR_audio_emitter?: { emitters?: GltfAudioEmitterJson[] };
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
