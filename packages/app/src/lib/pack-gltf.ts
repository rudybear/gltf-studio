// Multi-file `.gltf` import support (root-cause fix for the reported "scene
// tree shows but no meshes render" bug): TopBar's file input historically
// imported exactly one file, so a `.gltf` referencing external
// `buffers[].uri`/`images[].uri`/`KHR_audio_emitter.audio[].uri` siblings
// (the normal shape a `.gltf` + `.bin` + textures/audio export produces —
// e.g. the Khronos drum-kit sample, `.bin` + eight `.mp3`s) had no way to
// resolve those references at all; the editor silently ended up with a
// document whose accessors pointed at bytes nobody ever supplied.
//
// This module resolves every EXTERNAL (non `data:`) URI reference against a
// name -> file map (built by the caller from a multi-file `<input>`
// selection or a drag-and-drop `DataTransfer`), embeds each resolved
// resource as a new `bufferViews[]` entry backed by one consolidated binary
// blob, and rewrites the JSON so every one of those references becomes
// `bufferView`-based instead of `uri`-based. The result feeds
// `@gltfi/gltf`'s `writeContainer` to produce a single self-contained GLB —
// from that point on the app's normal GLB import path (`parseContainer` ->
// `createDocument`) applies unchanged, and export always writes one coherent
// `.glb` (never a document that still points outside itself).
//
// `data:` URIs are left untouched ("pass through") — they're already
// self-contained, so there's no reason to decode/re-embed them; only a
// *missing* external reference is worth failing loudly over (see
// `PackResult`'s `missing` case, surfaced by the caller as a toast rather
// than a silent empty viewport).
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

/** The minimal shape this module needs from a selected/dropped file — real `File` instances satisfy it, and so does a plain `{ name, arrayBuffer }` test double. */
export interface PackFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PackFileMap = Map<string, PackFileLike>;

export type PackResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; missing: string[] };

interface GltfBufferDef {
  uri?: string;
  byteLength: number;
}

interface GltfBufferViewDef {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

interface GltfImageDef {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

interface GltfAudioDef {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

interface GltfJsonShape {
  buffers?: GltfBufferDef[];
  bufferViews?: GltfBufferViewDef[];
  images?: GltfImageDef[];
  extensions?: {
    KHR_audio_emitter?: { audio?: GltfAudioDef[] };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function isDataUri(uri: string): boolean {
  return uri.startsWith("data:");
}

/**
 * glTF URIs may be percent-encoded or carry a leading "./"; a file map built
 * from a multi-select `<input>` or a dropped file set is keyed by plain
 * basenames. Mirrors @gltfi/gltf's own internal `lookupExternalFile` (not
 * part of its public API) so this module has no coupling to it.
 */
function lookupFile(fileMap: PackFileMap, uri: string): PackFileLike | undefined {
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
  for (const candidate of candidates) {
    const file = fileMap.get(candidate);
    if (file) return file;
  }
  return undefined;
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ktx2: "image/ktx2"
};

function guessImageMimeType(uri: string): string | undefined {
  const ext = uri.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_MIME_BY_EXTENSION[ext] : undefined;
}

function padTo4(bytes: Uint8Array): Uint8Array {
  const remainder = bytes.length % 4;
  if (remainder === 0) return bytes;
  const padded = new Uint8Array(bytes.length + (4 - remainder));
  padded.set(bytes);
  return padded;
}

/** Every external (non-`data:`) `uri` this document references, in encounter order (buffers, then images, then KHR_audio_emitter audio). */
function collectExternalUris(json: GltfJsonShape): string[] {
  const uris: string[] = [];
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri && !isDataUri(buffer.uri)) uris.push(buffer.uri);
  }
  for (const image of json.images ?? []) {
    if (image.uri && !isDataUri(image.uri)) uris.push(image.uri);
  }
  for (const audio of json.extensions?.KHR_audio_emitter?.audio ?? []) {
    if (audio.uri && !isDataUri(audio.uri)) uris.push(audio.uri);
  }
  return uris;
}

/**
 * Resolves every external reference in `gltfJson` against `fileMap` and
 * packs it into a single self-contained GLB. Returns `{ ok: false, missing
 * }` (naming every unresolved URI, deduplicated) without producing any bytes
 * if even one external reference can't be found — a caller should surface
 * that list verbatim rather than importing a document with dangling
 * references.
 */
export async function packMultiFileGltf(gltfJson: unknown, fileMap: PackFileMap): Promise<PackResult> {
  const json = JSON.parse(JSON.stringify(gltfJson)) as GltfJsonShape;

  // Pass 1: fail fast, and completely, on any unresolvable external URI —
  // never partially pack a document that will end up with dangling refs.
  const missing = new Set<string>();
  for (const uri of collectExternalUris(json)) {
    if (!lookupFile(fileMap, uri)) missing.add(uri);
  }
  if (missing.size > 0) {
    return { ok: false, missing: [...missing] };
  }

  // Pass 2: consolidate every external reference's bytes into one blob,
  // remapping `buffers[]`/`bufferViews[]`/`images[]`/audio `uri`s to point
  // at it. `data:` URIs are left exactly as-is (they need no file lookup and
  // are already self-contained).
  const segments: Uint8Array[] = [];
  let consolidatedLength = 0;

  async function appendSegment(uri: string): Promise<{ offset: number; byteLength: number }> {
    const file = lookupFile(fileMap, uri)!; // guaranteed present after pass 1
    const raw = new Uint8Array(await file.arrayBuffer());
    const padded = padTo4(raw);
    const offset = consolidatedLength;
    segments.push(padded);
    consolidatedLength += padded.length;
    return { offset, byteLength: raw.length };
  }

  const buffers = json.buffers ?? [];
  const bufferViews = json.bufferViews ?? [];

  // Buffers: data-URI (or GLB-binary, i.e. uri-less) buffers keep their own
  // slot in the rewritten `buffers[]`, in original order; external-URI
  // buffers instead become a segment of the consolidated buffer, and every
  // bufferView that referenced them is remapped below.
  const keptBuffers: GltfBufferDef[] = [];
  const bufferIndexRemap = new Map<number, number>(); // old buffer index -> new buffer index (kept, non-consolidated)
  const bufferSegmentOffset = new Map<number, number>(); // old buffer index -> offset within the consolidated buffer (for external buffers)

  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i];
    if (buffer.uri && !isDataUri(buffer.uri)) {
      bufferSegmentOffset.set(i, (await appendSegment(buffer.uri)).offset);
    } else {
      bufferIndexRemap.set(i, keptBuffers.length);
      keptBuffers.push(buffer);
    }
  }

  const consolidatedBufferIndex = keptBuffers.length; // reserved slot, appended once total length is known — see below.

  const newBufferViews: GltfBufferViewDef[] = bufferViews.map((view) => {
    if (bufferSegmentOffset.has(view.buffer)) {
      return {
        ...view,
        buffer: consolidatedBufferIndex,
        byteOffset: bufferSegmentOffset.get(view.buffer)! + (view.byteOffset ?? 0)
      };
    }
    return { ...view, buffer: bufferIndexRemap.get(view.buffer) ?? view.buffer };
  });

  // Images: any external-uri image gets its own new bufferView appended to
  // the consolidated buffer.
  const images = json.images ?? [];
  const newImages: GltfImageDef[] = [];
  for (const image of images) {
    if (image.uri && !isDataUri(image.uri)) {
      const { offset, byteLength } = await appendSegment(image.uri);
      const bufferViewIndex = newBufferViews.length;
      newBufferViews.push({ buffer: consolidatedBufferIndex, byteOffset: offset, byteLength });
      newImages.push({ bufferView: bufferViewIndex, mimeType: image.mimeType ?? guessImageMimeType(image.uri) });
    } else {
      newImages.push(image);
    }
  }

  // KHR_audio_emitter audio: same treatment as images, one new bufferView
  // per external-uri audio entry (this is what makes the drum-kit's eight
  // sibling .mp3s end up bufferView-addressable, matching what
  // @gltf-studio/audio-webaudio's WebAudioHost.loadEmitters already expects
  // for a real, non-fixture document).
  const audioList = json.extensions?.KHR_audio_emitter?.audio ?? [];
  const newAudio: GltfAudioDef[] = [];
  for (const audio of audioList) {
    if (audio.uri && !isDataUri(audio.uri)) {
      const { offset, byteLength } = await appendSegment(audio.uri);
      const bufferViewIndex = newBufferViews.length;
      newBufferViews.push({ buffer: consolidatedBufferIndex, byteOffset: offset, byteLength });
      newAudio.push({ bufferView: bufferViewIndex, mimeType: audio.mimeType });
    } else {
      newAudio.push(audio);
    }
  }

  const consolidated = new Uint8Array(consolidatedLength);
  let writeOffset = 0;
  for (const segment of segments) {
    consolidated.set(segment, writeOffset);
    writeOffset += segment.length;
  }

  const newBuffers: GltfBufferDef[] = [...keptBuffers];
  if (consolidatedLength > 0) {
    newBuffers.push({ byteLength: consolidatedLength });
  }

  const newJson: GltfJsonShape = {
    ...json,
    buffers: newBuffers,
    bufferViews: newBufferViews
  };
  if (json.images) {
    newJson.images = newImages;
  }
  if (json.extensions?.KHR_audio_emitter) {
    newJson.extensions = {
      ...json.extensions,
      KHR_audio_emitter: { ...json.extensions.KHR_audio_emitter, audio: newAudio }
    };
  }

  const jsonText = JSON.stringify(newJson);
  const chunks: Array<{ type: number; bytes: Uint8Array }> = [
    { type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }
  ];
  if (consolidatedLength > 0) {
    chunks.push({ type: CHUNK_TYPE_BIN, bytes: consolidated });
  }

  const container: Container = {
    kind: "glb",
    chunks,
    jsonChunkIndex: 0,
    jsonText,
    json: newJson
  };

  const bytes = writeContainer(container);
  return { ok: true, bytes: bytes as Uint8Array };
}
