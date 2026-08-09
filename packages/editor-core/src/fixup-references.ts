// Shared index-shift reference-fixup helper (DOC-019, DOC-020, DOC-021).
// Every command capable of shifting array indices (today: `GraphEdit.removeNode`;
// future structural `SceneEdit` ops per DOC-025/M8) calls this ONE helper
// rather than re-implementing its own fixup walk.
//
// Two kinds of embedded index reference exist in a KHR_interactivity-bearing
// glTF document:
//
//   - `graphNodeRef`: a `{ node: number, socket?: string }` value/flow
//     reference from one graph node to another *within the same graph*
//     (DOC-019's core case — used by `GraphEdit.removeNode` today).
//   - `jsonPointerLiteral`: a string leaf anywhere in the document that
//     embeds a JSON-pointer-shaped index reference as text, e.g. a
//     `pointer/get`/`pointer/set` node's literal template segment
//     (`"/nodes/3/translation"`) rather than a dynamic `{0}` parameter
//     (DOC-020's case — not yet exercised by any implemented command, since
//     the glTF-node-array-shifting commands that would produce these are
//     M8-stubbed `SceneEdit` structural ops, but the helper supports it now
//     so those future callers need no new fixup logic).
import type { JsonPatchOp } from "@gltf-studio/engine-api";
import { formatPointer, getIn } from "./json-pointer.js";

export type ReferenceKind =
  | { kind: "graphNodeRef"; graphPath: ReadonlyArray<string | number> }
  | { kind: "jsonPointerLiteral"; arrayName: string };

export type FixupPatches = { patches: JsonPatchOp[]; inverse: JsonPatchOp[] };

/**
 * Computes forward + inverse JSON Patch ops that rewrite every reference
 * whose embedded index is greater than `removedIndex` down by one, to
 * account for the shift caused by deleting the element at `removedIndex`.
 * Called against `json` as it stood BEFORE the removal itself (the caller
 * combines these with its own remove op via `combineCommandParts`).
 *
 * References equal to `removedIndex` itself (dangling references to the
 * element being deleted) are left untouched — repairing/rejecting a
 * dangling reference is a graph-validity concern (`@gltfi/ir`'s
 * `checkModule`/`validateGraph`), not an index-shift concern, and out of
 * scope for this helper.
 *
 * ORDERING REQUIREMENT for `graphNodeRef`: the caller MUST apply these
 * patches BEFORE the structural remove op itself (e.g.
 * `combineCommandParts([fixup, removeFragment])`, not the reverse) — every
 * `graphNodeRef` patch's PATH addresses a surviving sibling by its
 * PRE-removal index (`nodeIndex`), which is only correct while the array
 * still has its original layout. Applying the remove op first would shift
 * every surviving element's real array position out from under these paths.
 * The reference VALUE being written (via `shiftedIndex`) already accounts
 * for the post-removal index the *target* will have, independent of when
 * the structural remove itself runs.
 */
export function fixupReferences(
  json: unknown,
  removedIndex: number,
  refKinds: ReadonlyArray<ReferenceKind>
): FixupPatches {
  const patches: JsonPatchOp[] = [];
  const inverse: JsonPatchOp[] = [];
  for (const refKind of refKinds) {
    const result =
      refKind.kind === "graphNodeRef"
        ? fixupGraphNodeRefs(json, removedIndex, refKind.graphPath)
        : fixupJsonPointerLiterals(json, removedIndex, refKind.arrayName);
    patches.push(...result.patches);
    inverse.push(...result.inverse);
  }
  // Inverse order must reverse the forward order to undo sequentially.
  return { patches, inverse: inverse.reverse() };
}

function shiftedIndex(index: number, removedIndex: number): number | undefined {
  if (index > removedIndex) return index - 1;
  return undefined; // untouched (below) or dangling (equal) — no patch emitted.
}

function fixupGraphNodeRefs(
  json: unknown,
  removedIndex: number,
  graphPath: ReadonlyArray<string | number>
): FixupPatches {
  const graph = getIn(json, graphPath.map(String)) as
    | { nodes?: Array<{ values?: Record<string, unknown>; flows?: Record<string, unknown> }> }
    | undefined;
  if (!graph?.nodes) return { patches: [], inverse: [] };

  const patches: JsonPatchOp[] = [];
  const inverse: JsonPatchOp[] = [];
  graph.nodes.forEach((node, nodeIndex) => {
    if (nodeIndex === removedIndex) return; // this node is being deleted; its own (soon-gone) sockets don't need fixing up.
    for (const socketMapName of ["values", "flows"] as const) {
      const socketMap = node[socketMapName];
      if (!socketMap) continue;
      for (const [socket, ref] of Object.entries(socketMap)) {
        if (ref !== null && typeof ref === "object" && "node" in ref && typeof (ref as { node: unknown }).node === "number") {
          const refNode = (ref as { node: number }).node;
          const newIndex = shiftedIndex(refNode, removedIndex);
          if (newIndex !== undefined) {
            const path = formatPointer([...graphPath, "nodes", nodeIndex, socketMapName, socket, "node"]);
            patches.push({ op: "replace", path, value: newIndex });
            inverse.push({ op: "replace", path, value: refNode });
          }
        }
      }
    }
  });
  return { patches, inverse };
}

// Matches "/<arrayName>/<digits>" as a whole path segment boundary (not
// preceded/followed by another digit, so "/nodes/12" doesn't accidentally
// match as if it embedded "/nodes/1").
function jsonPointerLiteralPattern(arrayName: string): RegExp {
  return new RegExp(`(/${arrayName}/)(\\d+)(?=/|$)`, "g");
}

function fixupJsonPointerLiterals(json: unknown, removedIndex: number, arrayName: string): FixupPatches {
  const patches: JsonPatchOp[] = [];
  const inverse: JsonPatchOp[] = [];
  const pattern = jsonPointerLiteralPattern(arrayName);
  walkStrings(json, [], (value, path) => {
    pattern.lastIndex = 0;
    let matched = false;
    const rewritten = value.replace(pattern, (whole, prefix: string, digits: string) => {
      const index = Number(digits);
      const newIndex = shiftedIndex(index, removedIndex);
      if (newIndex === undefined) return whole;
      matched = true;
      return `${prefix}${newIndex}`;
    });
    if (matched) {
      const pointer = formatPointer(path);
      patches.push({ op: "replace", path: pointer, value: rewritten });
      inverse.push({ op: "replace", path: pointer, value });
    }
  });
  return { patches, inverse };
}

function walkStrings(value: unknown, path: (string | number)[], visit: (value: string, path: (string | number)[]) => void): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, [...path, index], visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(child, [...path, key], visit);
    }
  }
}
