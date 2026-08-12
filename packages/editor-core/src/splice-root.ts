// Canonical path -> splice-root table (DOC-022, DOC-038). `applyCommand`
// (document.ts) truncates every patch path through `canonicalSpliceRoot` and
// unions the results into `EditorDocument.dirtyRoots` (DOC-023); `save.ts`
// then splices exactly those roots (DOC-024).
//
// The table (DOC-038, resolving DOC-022's "full table" open question):
//
//   1. `/extensions/KHR_interactivity/graphs/{N}/...`  -> `/extensions/KHR_interactivity/graphs/{N}`
//      (one interactivity graph is the natural editable unit — GraphEdit's
//      own factories never touch more than one graph per command).
//   1b. `/extensions/KHR_audio_graph/graphs/{N}/...` -> `/extensions/KHR_audio_graph/graphs/{N}`
//      (DOC-057: same rationale as rule 1 — `AudioGraphEdit`'s own factories
//      never touch more than one `KHR_audio_graph` graph per command either).
//   2. `/extensions/{name}/...` (any other extension, including
//      `KHR_audio_emitter`) -> `/extensions/{name}` (the whole extension
//      object is the root; future PRs that want finer per-element roots for
//      a specific extension add a case ahead of this default, mirroring
//      rule 1 — most new extensions need no table change at all).
//   3. `/{arrayRootKey}/{N}/...` for every top-level glTF array root
//      (`nodes`, `meshes`, `materials`, `textures`, `images`, `samplers`,
//      `skins`, `accessors`, `bufferViews`, `buffers`, `animations`,
//      `scenes`, `cameras`) -> `/{arrayRootKey}/{N}` (one array element is
//      the editable unit — e.g. `SceneEdit.setTransform`'s
//      `/nodes/{i}/translation` truncates to `/nodes/{i}`, and
//      `node.extras.gltfi.{x,y}` (DOC-027) truncates the same way since it
//      is nested under the same node root).
//   4. Anything else (`/scene`, `/asset`, `/extensionsUsed`,
///     `/extensionsRequired`, `/extras`, or any future unrecognized
//      top-level key) -> the top-level key itself (`/{key}`), since these
//      are not arrays of independently-editable elements.
//
// `/` (the document root) is its own root — no command is expected to ever
// patch the root itself, but the function is total.
const ARRAY_ROOT_KEYS = new Set([
  "nodes",
  "meshes",
  "materials",
  "textures",
  "images",
  "samplers",
  "skins",
  "accessors",
  "bufferViews",
  "buffers",
  "animations",
  "scenes",
  "cameras"
]);

import { formatPointer, parsePointer } from "./json-pointer.js";

export function canonicalSpliceRoot(pointer: string): string {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return "/";

  const [first, ...rest] = segments;

  if (first === "extensions") {
    const extensionName = rest[0];
    if (extensionName === undefined) return "/extensions";
    if (extensionName === "KHR_interactivity" && rest[1] === "graphs" && rest.length >= 3) {
      return formatPointer(["extensions", "KHR_interactivity", "graphs", rest[2]]);
    }
    if (extensionName === "KHR_audio_graph" && rest[1] === "graphs" && rest.length >= 3) {
      return formatPointer(["extensions", "KHR_audio_graph", "graphs", rest[2]]);
    }
    return formatPointer(["extensions", extensionName]);
  }

  if (ARRAY_ROOT_KEYS.has(first) && rest.length >= 1) {
    return formatPointer([first, rest[0]]);
  }

  return formatPointer([first]);
}
