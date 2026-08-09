// Extracts a GLB container's BIN chunk bytes, for feeding
// @gltf-studio/audio-webaudio's `WebAudioHost.loadEmitters` the `{ json,
// binary }` container shape (so `bufferView`-referenced `KHR_audio_emitter`
// audio — the common case for a real exported asset, as opposed to a
// data:-URI-embedded fixture — actually resolves). A `.gltf`-kind container
// (parsed from plain JSON text, per @gltfi/gltf's `Container` type) has no
// separate binary chunk at all; `binary` is `null` there, same as a GLB with
// no BIN chunk (a valid, if audio-less-via-bufferView, document).
import type { Container } from "@gltfi/gltf";

const CHUNK_TYPE_BIN = 0x004e4942;

export function extractBinaryChunk(container: Container): ArrayBuffer | null {
  if (container.kind !== "glb") {
    return null;
  }
  const bin = container.chunks.find((chunk) => chunk.type === CHUNK_TYPE_BIN);
  if (!bin) {
    return null;
  }
  return bin.bytes.buffer.slice(bin.bytes.byteOffset, bin.bytes.byteOffset + bin.bytes.byteLength) as ArrayBuffer;
}
