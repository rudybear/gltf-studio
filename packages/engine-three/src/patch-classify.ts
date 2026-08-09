// patchScene's structural/non-structural classification (RH-011/RH-012/
// RH-013/RH-014, see specs/render-host.md). Reuses editor-core's
// canonicalSpliceRoot/parsePointer (the same table document.ts's applyCommand
// uses to compute EditorDocument.dirtyRoots) rather than re-deriving the
// splice-root table here — one table, one place it can drift.
import { canonicalSpliceRoot, parsePointer } from "@gltf-studio/editor-core";
import type { JsonPatchOp } from "@gltf-studio/engine-api";

const STRUCTURAL_ROOTS = new Set(["/nodes", "/scenes", "/scene", "/meshes"]);

/**
 * RH-011: true iff `path`'s immediate parent container (in `referenceJson`,
 * the currently-loaded document) is a JSON array — i.e. this patch, if
 * op is add/remove/move, changes an array's length or index-to-element
 * mapping.
 */
function targetsArrayElement(path: string, referenceJson: unknown): boolean {
  const segments = parsePointer(path);
  if (segments.length === 0) {
    return false;
  }
  let cursor: unknown = referenceJson;
  for (const segment of segments.slice(0, -1)) {
    if (cursor === null || typeof cursor !== "object") {
      return false;
    }
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : (cursor as Record<string, unknown>)[segment];
  }
  return Array.isArray(cursor);
}

/**
 * RH-011/RH-012/RH-013: classifies one JSON Patch op against the
 * currently-loaded document. `referenceJson` is the glTF JSON `loadScene`
 * was last called with (patchScene classifies against the document's
 * pre-patch shape).
 */
export function isStructuralPatch(patch: JsonPatchOp, referenceJson: unknown): boolean {
  if (
    (patch.op === "add" || patch.op === "remove" || patch.op === "move") &&
    targetsArrayElement(patch.path, referenceJson)
  ) {
    return true;
  }
  return STRUCTURAL_ROOTS.has(canonicalSpliceRoot(patch.path));
}

/** RH-014: a batch needs a reload if any single patch in it is structural. */
export function classifyPatchBatch(patches: readonly JsonPatchOp[], referenceJson: unknown): "applied" | "needs-reload" {
  return patches.some((patch) => isStructuralPatch(patch, referenceJson)) ? "needs-reload" : "applied";
}
