// specs/ux-inspector.md UX-416: the five core-glTF texture-info slots the
// Inspector's Texture Slots sub-section lists, in the SAME order the
// vendored @gltfi/three-adapter's own pointer-router (pointer-router.js's
// M1 baseColorTexture rows + its TEXTURE_INFO_ROUTES table) has a live
// KHR_texture_transform offset/scale/rotation route for — v1 deliberately
// stops at this exact set (matches the task's own scope) rather than also
// listing the KHR_materials_clearcoat/sheen extension texture slots the
// vendored router ALSO covers (a real, cheap follow-up, not attempted here).
import type { GltfJsonShape, GltfMaterialJson, GltfTextureInfoJson } from "./gltf-scene.js";

export type TextureSlotKey = "baseColorTexture" | "metallicRoughnessTexture" | "normalTexture" | "occlusionTexture" | "emissiveTexture";

export interface TextureSlotDef {
  key: TextureSlotKey;
  label: string;
  /** The material-relative path segments `SceneEdit.setMaterialProperty`/`clearMaterialTexture`/`setMaterialTextureTransform` address this slot's texture-info object through. */
  path: Array<string>;
}

export const TEXTURE_SLOTS: TextureSlotDef[] = [
  { key: "baseColorTexture", label: "Base Color", path: ["pbrMetallicRoughness", "baseColorTexture"] },
  { key: "metallicRoughnessTexture", label: "Metallic-Roughness", path: ["pbrMetallicRoughness", "metallicRoughnessTexture"] },
  { key: "normalTexture", label: "Normal", path: ["normalTexture"] },
  { key: "occlusionTexture", label: "Occlusion", path: ["occlusionTexture"] },
  { key: "emissiveTexture", label: "Emissive", path: ["emissiveTexture"] }
];

/** Reads whichever texture-info object (or `undefined`, when unset) `slot` names off `material` — the single place that knows how each slot's path nests (mirrors `pointer-vocab.ts`'s own "one vocabulary" discipline, scoped to texture slots). */
export function getTextureInfo(material: GltfMaterialJson | undefined, slot: TextureSlotDef): GltfTextureInfoJson | undefined {
  if (!material) return undefined;
  if (slot.key === "baseColorTexture") return material.pbrMetallicRoughness?.baseColorTexture;
  if (slot.key === "metallicRoughnessTexture") return material.pbrMetallicRoughness?.metallicRoughnessTexture;
  if (slot.key === "normalTexture") return material.normalTexture;
  if (slot.key === "occlusionTexture") return material.occlusionTexture;
  return material.emissiveTexture;
}

/** The `images[]` index a texture-info object resolves to, via `textures[textureInfo.index].source` — `undefined` when either level of that indirection is missing (a malformed/partial document, not expected from a real asset but not worth throwing over). */
export function imageIndexForTextureInfo(json: GltfJsonShape | undefined, textureInfo: GltfTextureInfoJson | undefined): number | undefined {
  if (!textureInfo) return undefined;
  return json?.textures?.[textureInfo.index]?.source;
}
