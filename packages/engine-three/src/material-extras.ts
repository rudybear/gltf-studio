// Richer inspector (specs/ux-inspector.md UX-415/UX-416): two material
// patch shapes the VENDORED @gltfi/three-adapter's own pointer-router
// (dist/pointer-router.js's ROUTER_TABLE) has no row for at all, handled
// directly against the live three.js materials here instead of waiting on
// an upstream vendor change:
//
//   - `doubleSided` (boolean) — a value-bearing patch, so `patch-classify.ts`
//     classifies it non-structural (booleans ARE a valid PointerValue) and
//     it reaches `applyNonStructuralPatch`; the vendored router has no
//     "/materials/*/doubleSided" row (that field maps 1:1 onto
//     `Material.side`, trivial enough that a full-reload round-trip would be
//     needlessly expensive for what is otherwise a live-tweakable property).
//   - a texture-info slot CLEAR (a JSON Patch `remove` op, e.g. removing
//     `/materials/{i}/pbrMetallicRoughness/baseColorTexture` wholesale) —
//     `patch-classify.ts` classifies this non-structural too (removing an
//     OBJECT property, not an array element, and there's no value to check
//     `isPointerValue` against for a `remove` op), but
//     `ThreeRenderHost.applyNonStructuralPatch`'s own op guard only ever
//     forwarded `add`/`replace` to the pointer-router — `remove` fell
//     through as a documented no-op. A cleared slot needs its three.js
//     material map nulled out directly; there is no pointer-router row for
//     "unset this texture" either (pointer/set only ever WRITES a value, it
//     has no delete verb in KHR_interactivity's own object model).
//
// Both helpers return `true` when they recognized and handled `patch`, so
// `render-host.ts`'s caller knows not to also try the generic pointer-router
// path for the same patch.
import * as THREE from "three";
import type { IndexTables } from "@gltfi/three-adapter";
import type { JsonPatchOp } from "@gltf-studio/engine-api";

const DOUBLE_SIDED_PATTERN = /^\/materials\/(\d+)\/doubleSided$/;

/**
 * Every core-glTF texture-info slot the Inspector's Texture Slots
 * sub-section (UX-416) lists, mapped to the three.js Material property
 * name(s) GLTFLoader.js assigns it to at load time — the SAME slot->three.js
 * mapping the vendored adapter's own `TEXTURE_INFO_ROUTES`
 * (pointer-router.js) uses for KHR_texture_transform offset/scale/rotation,
 * duplicated here (small, static, and this module deliberately has no
 * dependency on the vendor's internal, non-exported table) rather than
 * imported.
 */
const TEXTURE_SLOT_CLEAR_ROUTES: ReadonlyArray<{ pattern: RegExp; slots: string[] }> = [
  { pattern: /^\/materials\/(\d+)\/pbrMetallicRoughness\/baseColorTexture$/, slots: ["map"] },
  { pattern: /^\/materials\/(\d+)\/pbrMetallicRoughness\/metallicRoughnessTexture$/, slots: ["metalnessMap", "roughnessMap"] },
  { pattern: /^\/materials\/(\d+)\/normalTexture$/, slots: ["normalMap"] },
  { pattern: /^\/materials\/(\d+)\/occlusionTexture$/, slots: ["aoMap"] },
  { pattern: /^\/materials\/(\d+)\/emissiveTexture$/, slots: ["emissiveMap"] }
];

function toBool(value: unknown): boolean {
  if (Array.isArray(value)) return toBool(value[0]);
  if (typeof value === "boolean") return value;
  return Number(value) !== 0;
}

/**
 * UX-415: `doubleSided` -> `Material.side` (DoubleSide/FrontSide), for every
 * material in the fanout array. `false`/no-op when `patch` isn't a
 * doubleSided write or no tracked material exists for it (mirrors the
 * vendored router's own "note, don't throw" discipline — no diagnostics
 * recorder is threaded through here since this module has none of its own;
 * a missing material is silently inert, matching what an unrecognized
 * pointer would do too).
 *
 * Handles `remove` as well as `add`/`replace`: `SceneEdit.setMaterialProperty`
 * writes `doubleSided` via `setPathFragment`, which produces an `add` (not
 * `replace`) the FIRST time a material declares it — undoing that first
 * write is therefore a `remove` op, not a `replace true->false`. Missing
 * this case was a real bug caught by this feature's own e2e coverage (the
 * undo step left the live three.js material still `DoubleSide` even though
 * the document correctly reverted) — `remove` reverts to glTF's own spec
 * default for an absent `doubleSided` field: `false` (FrontSide).
 */
export function applyDoubleSidedPatch(tables: IndexTables, patch: JsonPatchOp): boolean {
  const match = DOUBLE_SIDED_PATTERN.exec(patch.path);
  if (!match) return false;
  if (patch.op !== "add" && patch.op !== "replace" && patch.op !== "remove") return false;
  const materialIndex = Number(match[1]);
  const materials = tables.materialsByIndex[materialIndex];
  if (!materials) return true; // recognized the shape; nothing tracked to apply it to.
  const doubleSided = patch.op === "remove" ? false : toBool(patch.value);
  for (const material of materials) {
    material.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
  }
  return true;
}

/** UX-416: clearing a texture-info slot -> nulling the corresponding three.js Material map slot(s), for every material in the fanout array. */
export function applyTextureSlotClearPatch(tables: IndexTables, patch: JsonPatchOp): boolean {
  if (patch.op !== "remove") return false;
  for (const route of TEXTURE_SLOT_CLEAR_ROUTES) {
    const match = route.pattern.exec(patch.path);
    if (!match) continue;
    const materialIndex = Number(match[1]);
    const materials = tables.materialsByIndex[materialIndex];
    if (!materials) return true;
    for (const material of materials) {
      const materialWithSlots = material as unknown as Record<string, unknown>;
      let touched = false;
      for (const slot of route.slots) {
        if (slot in materialWithSlots) {
          materialWithSlots[slot] = null;
          touched = true;
        }
      }
      if (touched) material.needsUpdate = true;
    }
    return true;
  }
  return false;
}
