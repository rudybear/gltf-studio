// Pure, structural-sharing RFC 6902 JSON Patch application over an arbitrary
// JSON value. Used by `applyCommand` (document.ts) to turn a `Command`'s
// `patches`/`inverse` into a new `EditorDocument.json` (DOC-005, DOC-006).
import type { JsonPatchOp } from "@gltf-studio/engine-api";
import { addIn, deepEqualJson, getIn, parsePointer, removeIn, replaceIn } from "./json-pointer.js";

/** Applies one RFC 6902 op to `json`, returning a new value (never mutates `json`). */
export function applyPatchOp(json: unknown, op: JsonPatchOp): unknown {
  const path = parsePointer(op.path);
  switch (op.op) {
    case "add":
      return addIn(json, path, op.value);
    case "replace":
      return replaceIn(json, path, op.value);
    case "remove":
      return removeIn(json, path);
    case "move": {
      if (op.from === undefined) throw new Error(`"move" op missing "from": ${JSON.stringify(op)}`);
      const value = getIn(json, parsePointer(op.from));
      const withoutSource = removeIn(json, parsePointer(op.from));
      return addIn(withoutSource, path, value);
    }
    case "copy": {
      if (op.from === undefined) throw new Error(`"copy" op missing "from": ${JSON.stringify(op)}`);
      const value = getIn(json, parsePointer(op.from));
      return addIn(json, path, value);
    }
    case "test": {
      const actual = getIn(json, path);
      if (!deepEqualJson(actual, op.value)) {
        throw new Error(`JSON Patch "test" failed at ${op.path}: expected ${JSON.stringify(op.value)}, got ${JSON.stringify(actual)}`);
      }
      return json;
    }
    default:
      throw new Error(`Unknown JSON Patch op: ${JSON.stringify(op)}`);
  }
}

/** Applies a sequence of RFC 6902 ops in order, returning a new value (DOC-005). */
export function applyPatches(json: unknown, ops: ReadonlyArray<JsonPatchOp>): unknown {
  let result = json;
  for (const op of ops) {
    result = applyPatchOp(result, op);
  }
  return result;
}
