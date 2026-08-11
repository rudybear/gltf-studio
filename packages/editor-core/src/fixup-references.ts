// Shared index-shift reference-fixup helper (DOC-019, DOC-020, DOC-021,
// extended by DOC-048 for `SceneEdit.removeNode`).
// Every command capable of shifting array indices (`GraphEdit.removeNode`,
// `SceneEdit.removeNode`) calls this ONE helper rather than re-implementing
// its own fixup walk.
//
// Five kinds of embedded index reference exist in a glTF document:
//
//   - `graphNodeRef`: a `{ node: number, socket?: string }` value/flow
//     reference from one graph node to another *within the same graph*
//     (DOC-019's core case — used by `GraphEdit.removeNode`).
//   - `jsonPointerLiteral`: a string leaf anywhere in the document that
//     embeds a JSON-pointer-shaped index reference as text, e.g. a
//     `pointer/get`/`pointer/set` node's literal template segment
//     (`"/nodes/3/translation"`) rather than a dynamic `{0}` parameter
//     (DOC-020's case — used by `SceneEdit.removeNode`, DOC-048).
//   - `graphConfigLiteral` (DOC-048): a raw number embedded (not wrapped in
//     a `{node}` ref, not embedded in a pointer string) at a graph node's
//     `configuration[field].value[0]` — e.g. `event/onSelect`/`onHoverIn`/
//     `onHoverOut`'s `configuration.nodeIndex` (`packages/usage-index`'s
//     `literalNumber` reads the identical field). The `-1` "no node"
//     sentinel these ops use is never touched: `shiftedIndex` only ever acts
//     on values `> removedIndex`, and `-1` never is.
//   - `indexArray` (DOC-048): an array living at an EXACT path whose
//     elements are (or, via `nodeFieldPath`, contain) a raw node-index
//     number — `scenes[i].nodes`, `nodes[i].children`, `skins[i].joints`,
//     and (with `nodeFieldPath: ["target","node"]`) `animations[i].channels`.
//     Unlike the graph-internal kinds above, a dangling entry here (one
//     equal to `removedIndex`) is DROPPED from the array rather than left
//     in place — these are core structural glTF arrays a renderer walks
//     directly, not editor-authored behavior-graph wiring a validator can
//     flag, so leaving a truly out-of-range index would corrupt the asset
//     rather than merely mark authored intent as stale.
//   - `indexScalar` (DOC-048): a single raw node-index number field at an
//     exact path — `skins[i].skeleton`. Same drop-on-match policy as
//     `indexArray`, applied to a lone field instead of an array (the
//     property itself is removed when its value equals `removedIndex`).
import type { JsonPatchOp } from "@gltf-studio/engine-api";
import { formatPointer, getIn } from "./json-pointer.js";

export type ReferenceKind =
  | { kind: "graphNodeRef"; graphPath: ReadonlyArray<string | number> }
  | { kind: "jsonPointerLiteral"; arrayName: string }
  | { kind: "graphConfigLiteral"; graphPath: ReadonlyArray<string | number>; field: string }
  | { kind: "indexArray"; path: ReadonlyArray<string | number>; nodeFieldPath?: ReadonlyArray<string | number> }
  | { kind: "indexScalar"; path: ReadonlyArray<string | number> };

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
        : refKind.kind === "jsonPointerLiteral"
          ? fixupJsonPointerLiterals(json, removedIndex, refKind.arrayName)
          : refKind.kind === "graphConfigLiteral"
            ? fixupGraphConfigLiteral(json, removedIndex, refKind.graphPath, refKind.field)
            : refKind.kind === "indexArray"
              ? fixupIndexArray(json, removedIndex, refKind.path, refKind.nodeFieldPath)
              : fixupIndexScalar(json, removedIndex, refKind.path);
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

/**
 * DOC-048: `graphConfigLiteral` — shifts a raw number embedded at
 * `graph.nodes[i].configuration[field].value[0]` (e.g. `event/onSelect`'s
 * `nodeIndex`), for every graph node that has one, regardless of that
 * node's declaration/op — a document with a stray `configuration[field]`
 * on some other op is simply a no-op match (`typeof raw !== "number"`
 * already guards non-numeric/absent fields; there is no numeric field named
 * `nodeIndex` anywhere else this helper's callers use it for). Mirrors
 * `fixupGraphNodeRefs`'s per-graph-node walk, but reads a literal instead of
 * a `{node}` ref.
 */
function fixupGraphConfigLiteral(
  json: unknown,
  removedIndex: number,
  graphPath: ReadonlyArray<string | number>,
  field: string
): FixupPatches {
  const graph = getIn(json, graphPath.map(String)) as
    | { nodes?: Array<{ configuration?: Record<string, { value?: unknown[] } | undefined> }> }
    | undefined;
  if (!graph?.nodes) return { patches: [], inverse: [] };

  const patches: JsonPatchOp[] = [];
  const inverse: JsonPatchOp[] = [];
  graph.nodes.forEach((node, nodeIndex) => {
    const raw = node.configuration?.[field]?.value?.[0];
    if (typeof raw !== "number") return;
    const newIndex = shiftedIndex(raw, removedIndex);
    if (newIndex === undefined) return; // below, or the -1/"any node" sentinel, or a dangling ref to the removed node itself — untouched.
    const path = formatPointer([...graphPath, "nodes", nodeIndex, "configuration", field, "value", 0]);
    patches.push({ op: "replace", path, value: newIndex });
    inverse.push({ op: "replace", path, value: raw });
  });
  return { patches, inverse };
}

/** Immutably writes `value` at `path` inside `obj`, cloning only the touched spine (mirrors `json-pointer.ts`'s `updateSpine`, but over a plain in-memory value rather than an RFC 6902 path string). */
function setNested(obj: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const record = (obj !== null && typeof obj === "object" ? (obj as Record<string, unknown>) : {}) as Record<string, unknown>;
  return { ...record, [head]: setNested(record[head], rest, value) };
}

/**
 * DOC-048: `indexArray` — the array at `path` holds, per element, either a
 * raw node-index number directly (`nodeFieldPath` omitted — `scenes[i].nodes`,
 * `nodes[i].children`, `skins[i].joints`) or an object whose node index lives
 * at `element[...nodeFieldPath]` (`animations[i].channels`, `nodeFieldPath:
 * ["target","node"]`). An element addressing `removedIndex` exactly is
 * DROPPED (not left dangling — see this file's header comment); an element
 * addressing something greater is shifted down by one in place. Emits ONE
 * `replace` (or, when the array would become empty, one `remove` of the
 * whole property — an empty `children`/`scenes[].nodes`/`skins[].joints`/
 * `animations[].channels` is not how this codebase represents "none", it
 * simply omits the property) covering every changed element, or no patch at
 * all when nothing in the array actually changes.
 */
function fixupIndexArray(
  json: unknown,
  removedIndex: number,
  path: ReadonlyArray<string | number>,
  nodeFieldPath?: ReadonlyArray<string | number>
): FixupPatches {
  const current = getIn(json, path.map(String));
  if (!Array.isArray(current)) return { patches: [], inverse: [] };

  const readIndex = (element: unknown): number | undefined => {
    const raw = nodeFieldPath === undefined ? element : getIn(element, nodeFieldPath.map(String));
    return typeof raw === "number" ? raw : undefined;
  };

  let changed = false;
  const next: unknown[] = [];
  for (const element of current) {
    const value = readIndex(element);
    if (value === undefined) {
      next.push(element);
      continue;
    }
    if (value === removedIndex) {
      changed = true; // dropped
      continue;
    }
    const newValue = shiftedIndex(value, removedIndex);
    if (newValue === undefined) {
      next.push(element);
      continue;
    }
    changed = true;
    next.push(nodeFieldPath === undefined ? newValue : setNested(element, nodeFieldPath.map(String), newValue));
  }

  if (!changed) return { patches: [], inverse: [] };
  const pointer = formatPointer(path);
  if (next.length === 0) {
    return { patches: [{ op: "remove", path: pointer }], inverse: [{ op: "add", path: pointer, value: current }] };
  }
  return { patches: [{ op: "replace", path: pointer, value: next }], inverse: [{ op: "replace", path: pointer, value: current }] };
}

/**
 * DOC-048: `indexScalar` — a single raw node-index number field at `path`
 * (`skins[i].skeleton`). Shifted down by one when greater than
 * `removedIndex`; the property is REMOVED (not left dangling) when it
 * equals `removedIndex` exactly, same drop-on-match policy as `indexArray`.
 */
function fixupIndexScalar(json: unknown, removedIndex: number, path: ReadonlyArray<string | number>): FixupPatches {
  const current = getIn(json, path.map(String));
  if (typeof current !== "number") return { patches: [], inverse: [] };
  const pointer = formatPointer(path);
  if (current === removedIndex) {
    return { patches: [{ op: "remove", path: pointer }], inverse: [{ op: "add", path: pointer, value: current }] };
  }
  const newValue = shiftedIndex(current, removedIndex);
  if (newValue === undefined) return { patches: [], inverse: [] };
  return { patches: [{ op: "replace", path: pointer, value: newValue }], inverse: [{ op: "replace", path: pointer, value: current }] };
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
