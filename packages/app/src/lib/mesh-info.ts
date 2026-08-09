// Pure helpers behind the Inspector's Mesh & Primitives section
// (specs/ux-inspector.md UX-407..410) — derived entirely from the document's
// own `meshes`/`accessors`/`nodes` arrays, matching the approved mockup's
// `meshSectionHtml`/`otherNodesUsingMesh` derivation (docs/ux/mockups/
// mockup-v5.html) rather than a second hand-authored copy of the same facts.
import type { GltfAccessorJson, GltfJsonShape, GltfMeshJson, GltfPrimitiveJson } from "./gltf-scene.js";

const MODE_LABELS: Record<number, string> = {
  0: "POINTS",
  1: "LINES",
  2: "LINE_LOOP",
  3: "LINE_STRIP",
  4: "TRIANGLES",
  5: "TRIANGLE_STRIP",
  6: "TRIANGLE_FAN"
};

/** glTF's own default primitive mode (4, TRIANGLES) when `mode` is omitted. */
export function primitiveModeLabel(mode: number | undefined): string {
  const resolved = mode ?? 4;
  return MODE_LABELS[resolved] ?? `mode ${resolved}`;
}

/**
 * Derived triangle count from the primitive's indices accessor (matching the
 * approved mockup's own derivation exactly) — `undefined` when the primitive
 * has no `indices` (non-indexed primitives aren't given a fallback vertex-
 * count-based estimate, mirroring the mockup's "?" case).
 */
export function triangleCount(primitive: GltfPrimitiveJson, accessors: GltfAccessorJson[]): number | undefined {
  if (primitive.indices === undefined) return undefined;
  const accessor = accessors[primitive.indices];
  if (!accessor) return undefined;
  return Math.round(accessor.count / 3);
}

/** UX-410: names of every OTHER scene node (besides `excludeNodeIndex`) whose `mesh` also references `meshIndex`. */
export function otherNodesUsingMesh(json: GltfJsonShape, meshIndex: number, excludeNodeIndex: number): string[] {
  const nodes = json.nodes ?? [];
  const names: string[] = [];
  nodes.forEach((node, i) => {
    if (i !== excludeNodeIndex && node.mesh === meshIndex) {
      names.push(node.name && node.name.length > 0 ? node.name : `Node ${i}`);
    }
  });
  return names;
}

/** Distinct material indices referenced by a mesh's primitives, in first-appearance order (a mesh with two primitives sharing one material lists it once). */
export function uniqueMaterialIndices(mesh: GltfMeshJson): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const primitive of mesh.primitives) {
    if (primitive.material !== undefined && !seen.has(primitive.material)) {
      seen.add(primitive.material);
      out.push(primitive.material);
    }
  }
  return out;
}
