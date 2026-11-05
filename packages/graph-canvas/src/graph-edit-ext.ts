// Small local extension of editor-core's `GraphEdit` command factories,
// built ONLY from editor-core's already-exported primitives
// (`appendFragment`/`getIn`/`combineCommandParts`/`makeCommandId`/
// `applyPatches`, plus `GraphEdit.setLiteral` itself) — this package's file
// boundary is new packages/graph-canvas/**, not packages/editor-core/**, so
// this stays a graph-canvas-local helper rather than a change to
// editor-core's own API surface.
//
// `GraphEdit` has no "ensure a types[] table entry" factory (only
// `ensureDeclaration`, for the declarations table) — but authoring a literal
// value for a socket that has never carried one before needs a `types[]`
// index to stamp on the new `{ type, value }` entry. `ensureTypeIndex`
// mirrors `ensureDeclaration`'s find-or-append shape for that table instead.
import {
  GraphEdit,
  appendFragment,
  applyPatches,
  combineCommandParts,
  getIn,
  makeCommandId,
  type Command,
  type EditorDocument
} from "@gltf-studio/editor-core";
import type { ValueType } from "@gltfi/kernel";

function graphPath(graphIndex: number): (string | number)[] {
  return ["extensions", "KHR_interactivity", "graphs", graphIndex];
}

/** Find-or-append a `{ signature }` entry into `graph.types`. Returns a no-op Command when it already exists, alongside its index. */
export function ensureTypeIndex(document: EditorDocument, graphIndex: number, signature: ValueType): { command: Command; index: number } {
  const typesPath = [...graphPath(graphIndex), "types"];
  const types = (getIn(document.json, typesPath.map(String)) as Array<{ signature: string }> | undefined) ?? [];
  const existingIndex = types.findIndex((t) => t.signature === signature);
  if (existingIndex !== -1) {
    return {
      index: existingIndex,
      command: { id: makeCommandId("ensure-type"), label: `Ensure type "${signature}"`, patches: [], inverse: [] }
    };
  }
  const fragment = appendFragment(document.json, typesPath, { signature });
  return {
    index: fragment.index,
    command: { id: makeCommandId("ensure-type"), label: `Ensure type "${signature}"`, patches: fragment.patches, inverse: fragment.inverse }
  };
}

/**
 * Sets `nodes[nodeIndex].values[socket]` to a literal of the given
 * (resolved) `signature`, ensuring a `types[]` entry for that signature
 * exists first (combined into one undoable Command, DOC-007/DOC-008).
 */
export function setLiteralValue(
  document: EditorDocument,
  graphIndex: number,
  nodeIndex: number,
  socket: string,
  signature: ValueType,
  rawValue: Array<number | boolean | string>
): Command {
  const { command: ensureCmd, index: typeIndex } = ensureTypeIndex(document, graphIndex, signature);
  const jsonAfterEnsure = ensureCmd.patches.length > 0 ? applyPatches(document.json, ensureCmd.patches) : document.json;
  const literalCmd = GraphEdit.setLiteral({ ...document, json: jsonAfterEnsure }, graphIndex, nodeIndex, socket, {
    type: typeIndex,
    value: rawValue
  });
  const combined = combineCommandParts([ensureCmd, literalCmd]);
  return {
    id: makeCommandId("set-literal-ext"),
    label: literalCmd.label,
    patches: combined.patches,
    inverse: combined.inverse
  };
}

/**
 * specs/ux-pointer-picker.md's `UX-906`: retargets an EXISTING `pointer/get|
 * set|interpolate` node's `configuration.pointer`/`configuration.type` in
 * one combined command, ensuring the new signature's `types[]` entry first
 * (`ensureTypeIndex`) — the pointer-picker dialog's "Use pointer" action
 * (`specs/ux-graph-canvas.md`'s `UX-509`'s `✎` icon flow) calls this rather
 * than `GraphEdit.addPointerNode` (which only ever APPENDS a brand new node).
 */
export function setPointerConfig(document: EditorDocument, graphIndex: number, nodeIndex: number, pointerPath: string, signature: ValueType): Command {
  const { command: ensureCmd, index: typeIndex } = ensureTypeIndex(document, graphIndex, signature);
  const jsonAfterEnsure = ensureCmd.patches.length > 0 ? applyPatches(document.json, ensureCmd.patches) : document.json;
  const docAfterEnsure: EditorDocument = { ...document, json: jsonAfterEnsure };
  const pointerCmd = GraphEdit.setNodeConfig(docAfterEnsure, graphIndex, nodeIndex, "pointer", [pointerPath]);
  const jsonAfterPointer = applyPatches(jsonAfterEnsure, pointerCmd.patches);
  const typeCmd = GraphEdit.setNodeConfig({ ...document, json: jsonAfterPointer }, graphIndex, nodeIndex, "type", [typeIndex]);
  const jsonAfterType = applyPatches(jsonAfterPointer, typeCmd.patches);

  // Keep the graph valid across a retarget: a `value` literal of the OLD type (or none at all) is
  // replaced by a neutral literal of the NEW type. A connected `value` is the user's wiring; left alone.
  const scaffold = pointerScaffoldCommands({ ...document, json: jsonAfterType }, graphIndex, nodeIndex, pointerPath, signature, { replaceMismatchedValue: true });

  const combined = combineCommandParts([ensureCmd, pointerCmd, typeCmd, ...scaffold]);
  return {
    id: makeCommandId("set-pointer-config"),
    label: `Retarget pointer node ${nodeIndex} -> ${pointerPath}`,
    patches: combined.patches,
    inverse: combined.inverse
  };
}

const NODE_NEUTRAL: Record<string, number[]> = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const MATERIAL_NEUTRAL: Record<string, number[]> = { baseColorFactor: [1, 1, 1, 1], metallicFactor: [1], roughnessFactor: [1] };
const COMPONENTS: Record<string, number> = { bool: 1, int: 1, float: 1, float2: 2, float3: 3, float4: 4 };

/**
 * A neutral (no-op) value for a pointer of type `signature`: the property's CURRENT value in the
 * document when readable and shape-compatible, else the glTF default / the type's zero
 * (float 0, floatN zeros, quaternion identity for `rotation`, bool false, int 0).
 */
export function neutralPointerValue(json: unknown, pointerPath: string, signature: string): Array<number | boolean> {
  const count = COMPONENTS[signature] ?? 1;
  const segments = pointerPath.split("/").slice(1).map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
  const current = getIn(json, segments.map(String) as string[]);
  if (signature === "bool") return [typeof current === "boolean" ? current : false];
  if (typeof current === "number" && count === 1) return [signature === "int" ? Math.trunc(current) : current];
  if (Array.isArray(current) && current.length === count && current.every((c) => typeof c === "number")) return [...(current as number[])];
  if (signature === "int") return [0];
  const last = String(segments[segments.length - 1] ?? "");
  const fallback = (segments[0] === "nodes" ? NODE_NEUTRAL[last] : segments[0] === "materials" ? MATERIAL_NEUTRAL[last] : undefined);
  if (fallback && fallback.length === count) return [...fallback];
  return new Array<number>(count).fill(0);
}

/**
 * Neutral defaults for a pointer/set | pointer/interpolate node so the graph validates and Play
 * runs it immediately with no visible effect: `value` = the property's current value (a no-op
 * write); interpolate also gets `duration` 1, `p1` [0,0], `p2` [1,1] (a linear-ish cubic Bezier)
 * when those sockets are absent. Returns [] for any other op. Commands are sequential (each
 * built against the document produced by the previous one).
 */
export function pointerScaffoldCommands(
  document: EditorDocument,
  graphIndex: number,
  nodeIndex: number,
  pointerPath: string,
  signature: string,
  opts: { replaceMismatchedValue?: boolean } = {}
): Command[] {
  const graph = getIn(document.json, ["extensions", "KHR_interactivity", "graphs", String(graphIndex)]) as
    | { types?: Array<{ signature: string }>; declarations?: Array<{ op: string }>; nodes?: Array<{ declaration: number; values?: Record<string, { type?: number; value?: unknown }> }> }
    | undefined;
  const node = graph?.nodes?.[nodeIndex];
  const op = node ? graph?.declarations?.[node.declaration]?.op : undefined;
  if (!node || (op !== "pointer/set" && op !== "pointer/interpolate")) return [];

  const out: Command[] = [];
  let doc = document;
  const put = (socket: string, sig: ValueType, value: Array<number | boolean>) => {
    const cmd = setLiteralValue(doc, graphIndex, nodeIndex, socket, sig, value);
    out.push(cmd);
    doc = { ...doc, json: applyPatches(doc.json, cmd.patches) };
  };

  const existing = node.values?.value;
  const existingSig = existing && typeof existing.type === "number" ? graph?.types?.[existing.type]?.signature : undefined;
  const isLiteral = existing !== undefined && "value" in existing;
  if (!existing || (opts.replaceMismatchedValue && isLiteral && existingSig !== signature)) {
    put("value", signature as ValueType, neutralPointerValue(document.json, pointerPath, signature));
  }
  if (op === "pointer/interpolate") {
    if (!node.values?.duration) put("duration", "float", [1]);
    if (!node.values?.p1) put("p1", "float2", [0, 0]);
    if (!node.values?.p2) put("p2", "float2", [1, 1]);
  }
  return out;
}
