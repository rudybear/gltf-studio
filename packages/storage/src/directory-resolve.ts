// Resolves glTF external URI references (or any requested filename) against
// a real (or shimmed) `FileSystemDirectoryHandle`-like directory tree,
// recursively. This backs the app's UX-117 "Grant folder access…" flow
// (`packages/app/src/store/app-store.ts`'s `grantFolderAndRetryImport`): once
// the user grants read access to the folder a single picked `.gltf` lives
// in, every sibling `buffers[].uri`/`images[].uri`/
// `KHR_audio_emitter.audio[].uri` it names gets resolved here, without a
// second manual multi-select or drag-and-drop.
//
// URI normalization (percent-decoding, stripping a leading "./", falling
// back to the bare basename) mirrors `packages/app/src/lib/pack-gltf.ts`'s
// own `lookupFile` so a URI that resolves via a multi-select file map
// resolves identically here — same candidate-name rules, different source
// (a directory tree instead of a flat `Map` built from an `<input>`
// selection).
import type { DirectoryHandleLike, FileLike } from "./fs-handle-types.js";

export type DirectoryFileMap = Map<string, FileLike>;

// Defends against a pathological/cyclic real filesystem (or a shim test
// deliberately constructing one); any real glTF asset folder (the drum-kit
// sample this feature was built against included) is flat or one level
// deep at most.
const MAX_DEPTH = 8;

/**
 * Every file in `dir`, recursively, keyed by its plain basename. A name
 * collision across subdirectories keeps whichever copy is found FIRST
 * (`dir.keys()` iteration order) — the same "flat basename" assumption
 * `pack-gltf.ts` already makes for a multi-select file map; real glTF asset
 * folders don't have same-named files in different subdirectories.
 */
export async function listFilesRecursive(dir: DirectoryHandleLike, depth = 0): Promise<DirectoryFileMap> {
  const out: DirectoryFileMap = new Map();
  if (depth > MAX_DEPTH) return out;
  for await (const name of dir.keys()) {
    let handled = false;
    try {
      const fileHandle = await dir.getFileHandle(name, { create: false });
      out.set(name, await fileHandle.getFile());
      handled = true;
    } catch {
      // Not a file (or getFileHandle rejected it) -- try as a directory below.
    }
    if (handled) continue;
    try {
      const subDir = await dir.getDirectoryHandle(name, { create: false });
      const nested = await listFilesRecursive(subDir, depth + 1);
      for (const [nestedName, file] of nested) {
        if (!out.has(nestedName)) out.set(nestedName, file);
      }
    } catch {
      // Neither a file nor a directory this handle will hand back -- skip it.
    }
  }
  return out;
}

/** Same URI-normalization candidates `pack-gltf.ts`'s `lookupFile` tries, in the same order. */
function candidateNames(uri: string): string[] {
  const candidates = new Set<string>([uri]);
  try {
    candidates.add(decodeURIComponent(uri));
  } catch {
    // Malformed percent-encoding; fall through with the raw URI.
  }
  for (const candidate of [...candidates]) {
    const stripped = candidate.replace(/^\.\//, "");
    candidates.add(stripped);
    const basename = stripped.split("/").pop();
    if (basename) candidates.add(basename);
  }
  return [...candidates];
}

/**
 * Resolves every URI in `uris` against every file found (recursively) under
 * `dir`. Returns a map from the ORIGINAL requested URI string (not
 * necessarily the matched basename) to its resolved file, plus a `missing`
 * list of any URI still unresolved after searching the whole directory --
 * the caller merges `resolved` into its existing multi-select/drop file map
 * and re-runs `packMultiFileGltf`.
 */
export async function resolveUrisFromDirectory(
  dir: DirectoryHandleLike,
  uris: string[]
): Promise<{ resolved: DirectoryFileMap; missing: string[] }> {
  const allFiles = await listFilesRecursive(dir);
  const resolved: DirectoryFileMap = new Map();
  const missing: string[] = [];
  for (const uri of uris) {
    const hit = candidateNames(uri)
      .map((candidate) => allFiles.get(candidate))
      .find((file): file is FileLike => file !== undefined);
    if (hit) resolved.set(uri, hit);
    else missing.push(uri);
  }
  return { resolved, missing };
}
