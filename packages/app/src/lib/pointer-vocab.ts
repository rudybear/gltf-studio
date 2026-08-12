// Shared glTF animatable-property vocabulary (specs/ux-pointer-picker.md's
// UX-9xx, specs/ux-graph-canvas.md's UX-505/508/509, specs/ux-inspector.md's
// UX-411/412): the SAME node/material property tables and path builders back
// the pointer-picker dialog's property list, the Inspector's `◈` affordance,
// and the scene-tree/graph-canvas drag-drop node creation — one vocabulary,
// never re-derived per call site (docs/ux/mockups/mockup-v5.html's own
// `NODE_PROPS`/`MATERIAL_PROPS`/`nodePropPath`/`materialPropPath` comment:
// "pointer-path vocabulary shared by the Inspector ◈ affordance, the
// pointer-picker dialog, and the drag-drop / create-node helpers").
//
// Node/material IDENTITIES (which nodes/materials/animations exist, their
// names) come from the live document (see `buildPointerContentTree` below);
// only the FIXED catalog of which properties on a node/material are
// pointer-addressable — the KHR_interactivity Object Model's node/material
// families — is a static table here. This is deliberately NOT exhaustive of
// glTF's full Object Model (no camera/light/KHR_texture_transform families,
// no KHR_materials_emissive_strength, etc.) — see this module's own "Known
// gaps" note at the bottom.
import type { GltfJsonShape } from "./gltf-scene.js";

export type PointerValueType = "bool" | "int" | "float" | "float2" | "float3" | "float4";

export interface AnimatablePropertyDef {
  key: string;
  label: string;
  /** The type NAME shown in the property's own type chip (UX-903) — may exceed the 4 real component types for a whole-array display label (e.g. "float[3]" for morph weights), see `wholeSelectable`. */
  type: string;
  /** Number of independently-addressable components; 0 = scalar (not expandable, UX-903). */
  comps: number;
  /** Whether the property's OWN row (not a component) is a valid, selectable pointer target — false for weights arrays with >4 targets, which have no KHR_interactivity value-type signature wide enough to address as a whole. */
  wholeSelectable: boolean;
}

function scalar(key: string, label: string): AnimatablePropertyDef {
  return { key, label, type: "float", comps: 0, wholeSelectable: true };
}
function vec(key: string, label: string, comps: 2 | 3 | 4): AnimatablePropertyDef {
  return { key, label, type: `float${comps}`, comps, wholeSelectable: true };
}

/** `/nodes/{i}/...`'s TRS family — every node has these three (glTF always defaults absent TRS to identity). */
export const NODE_PROPS: AnimatablePropertyDef[] = [vec("translation", "translation", 3), vec("rotation", "rotation", 4), vec("scale", "scale", 3)];

/** `/materials/{i}/...`'s pbrMetallicRoughness + emissive family. */
export const MATERIAL_PROPS: AnimatablePropertyDef[] = [
  vec("baseColorFactor", "baseColorFactor", 4),
  scalar("metallicFactor", "metallicFactor"),
  scalar("roughnessFactor", "roughnessFactor"),
  vec("emissiveFactor", "emissiveFactor", 3),
  scalar("alphaCutoff", "alphaCutoff")
];

/** Node property list for `nodeIndex`, appending a `weights` row IFF its mesh declares morph targets (UX-903's "float[N]" case). */
export function nodePropsFor(nodeIndex: number, json: GltfJsonShape | undefined): AnimatablePropertyDef[] {
  const node = json?.nodes?.[nodeIndex];
  const meshIndex = node?.mesh;
  const mesh = meshIndex !== undefined ? json?.meshes?.[meshIndex] : undefined;
  const weightCount = (mesh as { weights?: number[] } | undefined)?.weights?.length ?? mesh?.primitives?.[0]?.targets?.length ?? 0;
  if (weightCount > 0) {
    const weights: AnimatablePropertyDef = {
      key: "weights",
      label: "weights",
      type: `float[${weightCount}]`,
      comps: weightCount,
      wholeSelectable: weightCount <= 4 // only up to float4 has a real KHR_interactivity signature
    };
    return [...NODE_PROPS, weights];
  }
  return NODE_PROPS;
}

export function nodePropPath(nodeIndex: number, propKey: string, compIndex?: number): string {
  const base = `/nodes/${nodeIndex}/${propKey}`;
  return compIndex !== undefined ? `${base}/${compIndex}` : base;
}

const MATERIAL_PBR_KEYS = new Set(["baseColorFactor", "metallicFactor", "roughnessFactor"]);

export function materialPropPath(materialIndex: number, propKey: string, compIndex?: number): string {
  const base = MATERIAL_PBR_KEYS.has(propKey)
    ? `/materials/${materialIndex}/pbrMetallicRoughness/${propKey}`
    : `/materials/${materialIndex}/${propKey}`;
  return compIndex !== undefined ? `${base}/${compIndex}` : base;
}

/**
 * Richer inspector (specs/ux-inspector.md UX-417): the scalar
 * `KHR_lights_punctual` light properties the Inspector's Light section gives
 * a `◈` pointer-shortcut to (color is a picker, like `baseColorFactor`/
 * `emissiveFactor` — no `◈`, matching this codebase's established
 * "scalars get the shortcut, color pickers don't" convention). `range`/
 * `spot/innerConeAngle`/`spot/outerConeAngle` are only ever SHOWN by the
 * Light section for a point/spot (range) or spot-only (cone angles) light in
 * the first place — this table doesn't itself gate that, the section does.
 */
export const LIGHT_PROPS: AnimatablePropertyDef[] = [
  scalar("intensity", "intensity"),
  scalar("range", "range"),
  scalar("spot/innerConeAngle", "inner cone angle"),
  scalar("spot/outerConeAngle", "outer cone angle")
];

/** `/extensions/KHR_lights_punctual/lights/{i}/...` — addressed by LIGHT index (the root registry), not node index — see `GltfLightJson`'s own doc comment in `gltf-scene.ts`. */
export function lightPropPath(lightIndex: number, propKey: string): string {
  return `/extensions/KHR_lights_punctual/lights/${lightIndex}/${propKey}`;
}

/**
 * Richer inspector (specs/ux-inspector.md UX-418): the perspective-camera
 * scalar properties the Inspector's Camera section gives a `◈` to.
 */
export const CAMERA_PROPS: AnimatablePropertyDef[] = [scalar("yfov", "yfov"), scalar("znear", "znear"), scalar("zfar", "zfar")];

/** `/cameras/{i}/perspective/...` — core glTF, no extension involved. */
export function cameraPropPath(cameraIndex: number, propKey: string): string {
  return `/cameras/${cameraIndex}/perspective/${propKey}`;
}

// ---------------------------------------------------------------------------
// Content tree (UX-901): Nodes (full hierarchy) / Materials / Animations.
// ---------------------------------------------------------------------------

export type PointerTreeSection = "nodes" | "materials" | "animations";

export interface PointerTreeRow {
  section: PointerTreeSection;
  /** Node index (nodes), material index (materials), or animation index (animations). */
  index: number;
  label: string;
  depth: number; // nodes only; 0 for materials/animations
  icon: "mesh" | "light" | "camera" | "audio-emitter" | "group" | "clip";
}

/** Reuses `flattenSceneTree`'s own depth-first node order (imported by the caller) rather than re-walking `scenes[]` a second time — see PointerPickerDialog.tsx. */
export function buildPointerContentTree(
  json: GltfJsonShape | undefined,
  sceneRows: Array<{ nodeIndex: number; name: string; depth: number; icon: PointerTreeRow["icon"] }>
): PointerTreeRow[] {
  const nodes: PointerTreeRow[] = sceneRows.map((r) => ({ section: "nodes", index: r.nodeIndex, label: r.name, depth: r.depth, icon: r.icon }));
  const materials: PointerTreeRow[] = (json?.materials ?? []).map((m, i) => ({
    section: "materials",
    index: i,
    label: m.name ?? `Material ${i}`,
    depth: 0,
    icon: "group"
  }));
  const animations: PointerTreeRow[] = (json?.animations ?? []).map((a, i) => ({
    section: "animations",
    index: i,
    label: a.name ?? `Animation ${i}`,
    depth: 0,
    icon: "clip"
  }));
  return [...nodes, ...materials, ...animations];
}

// ---------------------------------------------------------------------------
// Reverse parse: a pointer path -> which tree row / property / component it
// names (UX-907's preselection). Returns null for any path this vocabulary
// doesn't recognize (an unrecognized/virtual/hand-authored path just opens
// the dialog with nothing preselected rather than guessing).
// ---------------------------------------------------------------------------

export interface ParsedPointer {
  section: PointerTreeSection;
  index: number;
  propKey: string;
  compIndex?: number;
  type: string;
}

export function parsePointerPath(path: string, json: GltfJsonShape | undefined): ParsedPointer | null {
  let m = /^\/nodes\/(\d+)\/(translation|rotation|scale|weights)(?:\/(\d+))?$/.exec(path);
  if (m) {
    const nodeIndex = Number(m[1]);
    const propKey = m[2]!;
    const compIndex = m[3] !== undefined ? Number(m[3]) : undefined;
    const prop = nodePropsFor(nodeIndex, json).find((p) => p.key === propKey);
    if (!prop) return null;
    return { section: "nodes", index: nodeIndex, propKey, compIndex, type: compIndex !== undefined ? "float" : prop.type };
  }
  m = /^\/materials\/(\d+)\/pbrMetallicRoughness\/(baseColorFactor|metallicFactor|roughnessFactor)(?:\/(\d+))?$/.exec(path);
  if (m) {
    const materialIndex = Number(m[1]);
    const propKey = m[2]!;
    const compIndex = m[3] !== undefined ? Number(m[3]) : undefined;
    const prop = MATERIAL_PROPS.find((p) => p.key === propKey)!;
    return { section: "materials", index: materialIndex, propKey, compIndex, type: compIndex !== undefined ? "float" : prop.type };
  }
  m = /^\/materials\/(\d+)\/(emissiveFactor|alphaCutoff)(?:\/(\d+))?$/.exec(path);
  if (m) {
    const materialIndex = Number(m[1]);
    const propKey = m[2]!;
    const compIndex = m[3] !== undefined ? Number(m[3]) : undefined;
    const prop = MATERIAL_PROPS.find((p) => p.key === propKey)!;
    return { section: "materials", index: materialIndex, propKey, compIndex, type: compIndex !== undefined ? "float" : prop.type };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Color detection (task: "for such cases as input for material when we
// clearly know this is color, we can add color pickers" — specs/ux-graph-canvas.md
// UX-5xx typed-literal-editors work): a pointer PATH (not a value type alone
// — `float3`/`float4` also cover plain non-color vectors like `translation`
// or `scale`) that is semantically a color gets a color-picker literal
// editor instead of grouped numeric fields, in `pointer/set|interpolate`
// nodes' inline/side-panel literal editors. Pure, path-only pattern
// matching (no document access needed) — canonical here per this module's
// own "one vocabulary, never re-derived per call site" header; MIRRORED
// (not imported — @gltf-studio/graph-canvas has no dependency on
// packages/app, the reverse of this package's own dependency on
// @gltf-studio/graph-canvas) as a small zero-dependency copy in that
// package's own `color-field.tsx`, same convention this codebase already
// uses for HANDLER_OPS/ANIMATION_OPS across map-graph.ts/op-node.tsx/
// usage-index. Deliberately NOT exhaustive (same "known gaps" spirit as the
// rest of this file): `KHR_materials_sheen`'s `sheenColorFactor`,
// `KHR_materials_specular`'s `specularColorFactor`, and any other
// extension-authored color factor are real follow-ups, not covered here.
export type ColorKind = "rgb" | "rgba";

const COLOR_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; kind: ColorKind }> = [
  // /materials/{i}/pbrMetallicRoughness/baseColorFactor — float4 (RGBA).
  { re: /\/pbrMetallicRoughness\/baseColorFactor$/, kind: "rgba" },
  // /materials/{i}/emissiveFactor — float3 (RGB, no alpha channel in glTF core).
  { re: /\/materials\/\d+\/emissiveFactor$/, kind: "rgb" },
  // /extensions/KHR_lights_punctual/lights/{i}/color — float3 (RGB).
  { re: /\/extensions\/KHR_lights_punctual\/lights\/\d+\/color$/, kind: "rgb" }
];

/** Returns `"rgb"`/`"rgba"` when `pointerPath` names a KNOWN color property, `undefined` otherwise (e.g. `translation`/`scale`/`metallicFactor` — a plain numeric/vector field, not a color, gets the ordinary grouped-numeric-fields editor instead). Matches on the path's SUFFIX (a fixed property name), independent of which node/material index prefixes it or whether that index came from a literal number or a dynamic pointer-template parameter. */
export function colorKindForPointerPath(pointerPath: string): ColorKind | undefined {
  for (const { re, kind } of COLOR_PATH_PATTERNS) {
    if (re.test(pointerPath)) return kind;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Known gaps (honest, not silently dropped): this vocabulary covers the
// common TRS + pbrMetallicRoughness/emissive/alphaCutoff families the
// approved mockup itself demonstrates, PLUS (richer inspector,
// specs/ux-inspector.md UX-417/UX-418) LIGHT_PROPS/CAMERA_PROPS + their own
// path builders, added for the Inspector's own `◈` affordance on its Light/
// Camera sections. NOT covered (a real follow-up, not invented here):
// KHR_texture_transform (offset/rotation/scale — editable in the Inspector's
// Texture Slots sub-section, but via `SceneEdit.setMaterialTextureTransform`
// directly, not through this shared vocabulary/the `◈` affordance),
// KHR_materials_* extension factors (emissive strength, IOR, sheen, ...),
// and KHR_audio_emitter/KHR_node_visibility (the mockup's own
// NODE_PROPS/EMITTER_EXTRA_PROP superset for those two families is scene-
// fixture-specific, not derivable from an arbitrary document the way
// TRS/pbr are, so it is intentionally not carried over here — see the PR
// description's "honest gaps"). Lights/cameras are also not yet part of
// `buildPointerContentTree`/`parsePointerPath` (the pointer-picker dialog's
// own content tree only enumerates nodes/materials/animations) — the
// Inspector's `◈` affordance uses `LIGHT_PROPS`/`CAMERA_PROPS` directly and
// doesn't need that reverse-lookup, but the pointer-picker dialog itself
// still can't target a light/camera property by hand — a follow-up.
