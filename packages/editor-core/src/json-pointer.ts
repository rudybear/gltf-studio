// RFC 6901 JSON Pointer parsing/formatting plus a small immutable tree-update
// toolkit (get/set/insert/remove-with-shift) that every command factory and
// `applyPatches` (patch.ts) builds on. Kept dependency-free and pure: every
// function here either reads `json` or returns a *new* value — none ever
// mutates an input in place (DOC-002, DOC-005, DOC-006).

/** Splits a JSON Pointer string into raw (unescaped) segments. `""` -> `[]`. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON pointer (must start with "/" or be ""): ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Formats raw segments back into a JSON Pointer string. Escapes `~`/`/`. */
export function formatPointer(segments: ReadonlyArray<string | number>): string {
  if (segments.length === 0) return "";
  return (
    "/" +
    segments
      .map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
      .join("/")
  );
}

/**
 * Given a JSON Pointer string and a reference JSON value to walk (to learn,
 * at each step, whether the container is an array or an object), returns
 * typed segments: `number` for array-index segments, `string` for object
 * keys. This is the shape `@gltfi/gltf`'s `locateJsonSpan` requires (its
 * scanner branches on `typeof segment`), whereas `applyPatches` below is
 * happy with raw string segments throughout (JS bracket access on an array
 * with a numeric-string key works identically to a numeric index).
 */
export function typedPathFromPointer(
  pointer: string,
  referenceJson: unknown
): (string | number)[] | undefined {
  const segments = parsePointer(pointer);
  const typed: (string | number)[] = [];
  let cursor: unknown = referenceJson;
  for (const segment of segments) {
    if (cursor === undefined || cursor === null) return undefined;
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(segment)) return undefined;
      const index = Number(segment);
      typed.push(index);
      cursor = cursor[index];
    } else if (typeof cursor === "object") {
      typed.push(segment);
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return typed;
}

/** Reads the value at `path` (raw segments — `string` object keys or `number` array indices both work via JS bracket access), or `undefined` if absent. */
export function getIn(json: unknown, path: ReadonlyArray<string | number>): unknown {
  let cursor: unknown = json;
  for (const segment of path) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** True iff every ancestor object/array along `path` (exclusive of the final segment) exists. */
export function parentExists(json: unknown, path: ReadonlyArray<string>): boolean {
  if (path.length === 0) return true;
  return getIn(json, path.slice(0, -1)) !== undefined || path.length === 1;
}

function cloneWithChild(parent: unknown, segment: string, newChild: unknown): unknown {
  if (Array.isArray(parent)) {
    const index = Number(segment);
    const copy = parent.slice();
    copy[index] = newChild;
    return copy;
  }
  if (parent !== null && typeof parent === "object") {
    return { ...(parent as Record<string, unknown>), [segment]: newChild };
  }
  throw new Error(`Cannot set property "${segment}" on non-object/array value: ${JSON.stringify(parent)}`);
}

function cloneWithoutChild(parent: unknown, segment: string): unknown {
  if (Array.isArray(parent)) {
    const index = Number(segment);
    const copy = parent.slice();
    copy.splice(index, 1); // RFC 6902 array remove: shifts subsequent elements down.
    return copy;
  }
  if (parent !== null && typeof parent === "object") {
    const copy = { ...(parent as Record<string, unknown>) };
    delete copy[segment];
    return copy;
  }
  throw new Error(`Cannot remove property "${segment}" from non-object/array value: ${JSON.stringify(parent)}`);
}

function cloneWithInsertedChild(parent: unknown, segment: string, value: unknown): unknown {
  if (Array.isArray(parent)) {
    const index = segment === "-" ? parent.length : Number(segment);
    const copy = parent.slice();
    copy.splice(index, 0, value); // RFC 6902 array add: shifts subsequent elements up.
    return copy;
  }
  if (parent !== null && typeof parent === "object") {
    return { ...(parent as Record<string, unknown>), [segment]: value };
  }
  throw new Error(`Cannot insert property "${segment}" into non-object/array value: ${JSON.stringify(parent)}`);
}

/**
 * Immutably recurses down `path`, applying `updater` to the deepest existing
 * parent + its final segment, and rebuilding every ancestor along the way as
 * a fresh shallow clone. Every subtree not on `path` keeps its original
 * object identity (DOC-006): only the spine from the root down to the
 * touched parent is ever cloned.
 */
function updateSpine(
  json: unknown,
  path: ReadonlyArray<string>,
  updater: (parent: unknown, lastSegment: string) => unknown
): unknown {
  if (path.length === 0) {
    throw new Error("Cannot update the document root itself via a JSON Patch path.");
  }
  if (path.length === 1) {
    return updater(json, path[0]);
  }
  const [head, ...rest] = path;
  const child = json !== null && typeof json === "object" ? (json as Record<string, unknown>)[head] : undefined;
  const newChild = updateSpine(child, rest, updater);
  return cloneWithChild(json, head, newChild);
}

/** RFC 6902 "replace"-shaped write: object key set, array element replaced in place (no shift). */
export function replaceIn(json: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
  return updateSpine(json, path, (parent, seg) => cloneWithChild(parent, seg, value));
}

/** RFC 6902 "add"-shaped write: object key set/created, array element inserted with shift. */
export function addIn(json: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
  return updateSpine(json, path, (parent, seg) => cloneWithInsertedChild(parent, seg, value));
}

/** RFC 6902 "remove"-shaped write: object key deleted, array element removed with shift. */
export function removeIn(json: unknown, path: ReadonlyArray<string>): unknown {
  return updateSpine(json, path, (parent, seg) => cloneWithoutChild(parent, seg));
}

/** Structural deep-equality over plain JSON values (objects/arrays/primitives). */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqualJson(item, b[index]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        deepEqualJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  return false;
}

/** Deep-clones a plain JSON value (used only where a value must not alias a source it will outlive mutation of). */
export function deepCloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
