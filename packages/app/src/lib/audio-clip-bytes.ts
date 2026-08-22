// Resolves ONE `KHR_audio_emitter.audio[]` clip entry to raw playable bytes,
// for the Assets > Audio Clips tab's preview-play/duration/Import/Embed
// flows — an app-layer counterpart to `@gltf-studio/audio-webaudio`'s own
// PRIVATE `resolveBufferView`/`decodeDataUri` (that package has no public
// "give me this clip's bytes" API; its only public surface is the whole
// `AudioHost` interface, which plays through a live emitter graph, not a
// standalone clip out of context — the Assets tab needs the raw bytes
// themselves, e.g. to decode a duration or to re-embed them).
import type { GltfJsonShape } from "./gltf-scene.js";

function decodeDataUri(uri: string): ArrayBuffer | undefined {
  const match = uri.match(/^data:[^,]*;base64,(.*)$/s);
  if (!match) {
    return undefined;
  }
  const binaryString = atob(match[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Resolves `json.extensions.KHR_audio_emitter.audio[clipIndex]` to raw
 * bytes when it's EMBEDDED (a `bufferView` clip, always resolvable — no
 * network/folder-grant dependency) — `binary` is the document container's
 * BIN chunk (`extractBinaryChunk`, `null` for a `.gltf`-kind container or a
 * `.glb` with no BIN chunk), read against when the clip's `buffers[]` entry
 * has no own `data:` uri. Returns `null` for a uri-referenced clip (use the
 * live `AudioHost`'s resolver / `getUnresolvedAudioUris()` for those
 * instead — this function never does network/folder I/O) or a malformed
 * reference.
 */
export function resolveEmbeddedClipBytes(json: GltfJsonShape, binary: ArrayBuffer | null, clipIndex: number): ArrayBuffer | null {
  const clip = json.extensions?.KHR_audio_emitter?.audio?.[clipIndex];
  if (!clip || typeof clip.bufferView !== "number") {
    return null;
  }
  const view = json.bufferViews?.[clip.bufferView] as { buffer: number; byteOffset?: number; byteLength: number } | undefined;
  if (!view) {
    return null;
  }
  const bufferDef = json.buffers?.[view.buffer] as { uri?: string } | undefined;
  const offset = view.byteOffset ?? 0;
  if (bufferDef?.uri) {
    const decoded = decodeDataUri(bufferDef.uri);
    return decoded ? decoded.slice(offset, offset + view.byteLength) : null;
  }
  if (!binary) {
    return null;
  }
  return binary.slice(offset, offset + view.byteLength);
}
