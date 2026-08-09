// Small shared "patch fragment" builders used by every `GraphEdit`/`SceneEdit`
// factory: each inspects the CURRENT `json` to decide `add` vs `replace` vs
// `remove` and to capture the exact prior value for `inverse` (DOC-007,
// DOC-008), so no factory hand-writes its own add/replace/remove branching.
import type { JsonPatchOp } from "@gltf-studio/engine-api";
import { formatPointer, getIn } from "./json-pointer.js";

export type PatchPair = { patches: JsonPatchOp[]; inverse: JsonPatchOp[] };

/** "Set a value at a path": `replace` if something is already there, `add` (creating missing ancestor objects in one hop) if not. */
export function setPathFragment(json: unknown, path: (string | number)[], value: unknown): PatchPair {
  const existing = getIn(json, path.map(String));
  if (existing !== undefined) {
    return {
      patches: [{ op: "replace", path: formatPointer(path), value }],
      inverse: [{ op: "replace", path: formatPointer(path), value: existing }]
    };
  }
  let depth = path.length - 1;
  while (depth > 0 && getIn(json, path.slice(0, depth).map(String)) === undefined) {
    depth -= 1;
  }
  const addPath = path.slice(0, depth + 1);
  const remainder = path.slice(depth + 1);
  const addValue = remainder.reduceRight<unknown>((inner, segment) => ({ [segment]: inner }), value);
  return {
    patches: [{ op: "add", path: formatPointer(addPath), value: addValue }],
    inverse: [{ op: "remove", path: formatPointer(addPath) }]
  };
}

/** Deletes whatever currently exists at `path` (throws if nothing does). */
export function deletePathFragment(json: unknown, path: (string | number)[]): PatchPair {
  const existing = getIn(json, path.map(String));
  if (existing === undefined) {
    throw new Error(`Cannot disconnect: nothing exists at ${formatPointer(path)}.`);
  }
  return {
    patches: [{ op: "remove", path: formatPointer(path) }],
    inverse: [{ op: "add", path: formatPointer(path), value: existing }]
  };
}

/** Appends `value` to the end of the array at `arrayPath` (creating the array itself if absent). Returns the new element's index. */
export function appendFragment(json: unknown, arrayPath: (string | number)[], value: unknown): PatchPair & { index: number } {
  const current = getIn(json, arrayPath.map(String)) as unknown[] | undefined;
  const index = current?.length ?? 0;
  if (current !== undefined) {
    return {
      index,
      patches: [{ op: "add", path: formatPointer([...arrayPath, index]), value }],
      inverse: [{ op: "remove", path: formatPointer([...arrayPath, index]) }]
    };
  }
  const fragment = setPathFragment(json, arrayPath, [value]);
  return { index, ...fragment };
}
