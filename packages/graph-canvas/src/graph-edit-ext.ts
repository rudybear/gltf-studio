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
