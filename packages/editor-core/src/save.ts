// Save (DOC-024, DOC-025, DOC-026): splice each dirty root into the pristine
// container's bytes independently via `locateJsonSpan`/`applyEdits`, one
// root at a time (DOC-024); fall back to reserializing the ENTIRE document
// for this save (mirroring `@gltfi/gltf`'s own `spliceGraph` fallback) the
// moment any dirty root can't be located in the pristine text — e.g. because
// it (or something ahead of it in the same array) was newly created or
// renumbered since the last save (DOC-025). Byte-preservation outside dirty
// roots (DOC-026) then falls directly out of `locateJsonSpan`/`applyEdits`
// only ever rewriting the spans we explicitly located.
//
// DOC-048 fix: per-root splicing on its own is NOT sufficient to detect
// every renumbering DOC-025 means to catch. `dirtyRoots` (DOC-004) only ever
// records the canonical splice root of each patch's OWN path — a structural
// `remove` at `/nodes/{i}` (`SceneEdit.removeNode`/`GraphEdit.removeNode`)
// implicitly shifts every LATER array element down by one (RFC 6902 array
// semantics), but that shift produces no patch of its own and so marks no
// dirty root for the elements it silently moved. Before this fix, splicing
// ONLY the explicitly-dirty root(s) against the PRISTINE text in that case
// would successfully `locateJsonSpan` a stale-but-existing span (e.g. the
// removed element's old neighbor) and overwrite just that one slot, leaving
// the array's now-stale tail element(s) byte-untouched — silently
// DUPLICATING content rather than throwing or falling back. Caught by the
// DOC-034 property test the first time `removeSceneNode` actually shrank a
// top-level array (append-only structural ops never exercised this, since
// appending never shifts an EXISTING element). Fixed generally, without
// needing to enumerate every specific shift-shaped command, by verifying
// the spliced result actually reparses to `document.json` before trusting
// it (see `trySplice`'s own comment) — any mismatch degrades to the
// existing whole-document `reserialize` fallback instead of shipping wrong
// bytes.
import { applyEdits, locateJsonSpan, writeContainer, type Container } from "@gltfi/gltf";
import type { EditorDocument } from "./document.js";
import { deepEqualJson, getIn, typedPathFromPointer } from "./json-pointer.js";

export interface SaveReport {
  /** Dirty-root JSON pointers that were successfully byte-spliced (empty when `reserialized` is true). */
  splicedRoots: string[];
  /** True when the whole-document reserialize fallback (DOC-025) was used instead of per-root splicing. */
  reserialized: boolean;
  /** The bytes actually written (`.glb` binary, or UTF-8 encoded `.gltf` JSON text). */
  bytes: Uint8Array;
}

export interface SaveResult {
  /** The new `EditorDocument`: `container` is the just-written bytes' parse (the new pristine baseline), `dirtyRoots` is cleared. `json`/`rev`/`frozen` are unchanged — saving persists content, it doesn't change it. */
  document: EditorDocument;
  report: SaveReport;
}

export function save(document: EditorDocument): SaveResult {
  const dirtyRoots = [...document.dirtyRoots];

  if (dirtyRoots.length > 0) {
    const spliced = trySplice(document, dirtyRoots);
    if (spliced) {
      return spliced;
    }
  }

  return reserialize(document, dirtyRoots.length === 0);
}

function trySplice(document: EditorDocument, dirtyRoots: string[]): SaveResult | undefined {
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const jsonText = document.container.jsonText;

  for (const root of dirtyRoots) {
    const typedPath = typedPathFromPointer(root, document.json);
    if (typedPath === undefined) return undefined; // newly created / can no longer be typed against current json.
    const span = locateJsonSpan(jsonText, typedPath);
    if (span === undefined) return undefined; // renumbered/newly created since last save (DOC-025).
    const value = getIn(document.json, typedPath);
    edits.push({ start: span.start, end: span.end, replacement: JSON.stringify(value) });
  }

  const newJsonText = applyEdits(jsonText, edits);

  // DOC-048 safety net (see this file's header comment): a per-root splice
  // that LOOKS successful (every root found a span) can still produce wrong
  // bytes when some OTHER element of the same array silently shifted
  // without earning its own dirty-root entry. Verify by reparsing and
  // deep-equality-checking against the true in-memory json before trusting
  // this splice — degrade to the whole-document reserialize fallback
  // instead of ever returning a result that would violate DOC-034's own
  // "reparsing saved bytes deep-equals the in-memory json" invariant.
  let newJson: unknown;
  try {
    newJson = JSON.parse(newJsonText);
  } catch {
    return undefined;
  }
  if (!deepEqualJson(newJson, document.json)) return undefined;

  const newContainer = rebuildContainerText(document.container, newJsonText);
  const bytes = toBytes(writeContainer(newContainer));

  return {
    document: { ...document, container: newContainer, dirtyRoots: new Set() },
    report: { splicedRoots: dirtyRoots, reserialized: false, bytes }
  };
}

function reserialize(document: EditorDocument, noopSave: boolean): SaveResult {
  // A no-op save (nothing dirty) just re-emits the pristine container's own
  // bytes — not a "reserialize" in the DOC-025 sense (no fallback was
  // needed), so it is reported as `reserialized: false`.
  const newJsonText = noopSave ? document.container.jsonText : JSON.stringify(document.json);
  const newContainer = noopSave ? document.container : rebuildContainerText(document.container, newJsonText);
  const bytes = toBytes(writeContainer(newContainer));

  return {
    document: { ...document, container: newContainer, dirtyRoots: new Set() },
    report: { splicedRoots: [], reserialized: !noopSave, bytes }
  };
}

// Mirrors `@gltfi/gltf`'s own (unexported) container.ts `rebuildContainerWithJsonText`:
// only the JSON chunk's bytes change; every other chunk (BIN, unrecognized
// chunk types) carries through byte-verbatim, in its original position.
function rebuildContainerText(container: Container, jsonText: string): Container {
  const json = JSON.parse(jsonText);
  if (container.kind === "gltf") {
    return { kind: "gltf", jsonText, json };
  }
  const chunks = container.chunks.map((chunk, index) =>
    index === container.jsonChunkIndex ? { type: chunk.type, bytes: new TextEncoder().encode(jsonText) } : chunk
  );
  return {
    kind: "glb",
    chunks,
    jsonChunkIndex: container.jsonChunkIndex,
    jsonText,
    json,
    binaryChunk: container.binaryChunk
  };
}

function toBytes(written: Uint8Array | string): Uint8Array {
  return typeof written === "string" ? new TextEncoder().encode(written) : written;
}
