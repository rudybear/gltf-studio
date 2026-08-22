import { describe, expect, it } from "vitest";
import { resolveEmbeddedClipBytes } from "./audio-clip-bytes.js";
import type { GltfJsonShape } from "./gltf-scene.js";

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("resolveEmbeddedClipBytes", () => {
  it("resolves a bufferView-embedded clip against a binary (GLB BIN chunk) buffer", () => {
    const binary = new Uint8Array([0, 0, 0, 0, 10, 20, 30, 40, 0, 0]).buffer;
    const json: GltfJsonShape = {
      bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 4 }],
      buffers: [{ byteLength: 10 }],
      extensions: { KHR_audio_emitter: { audio: [{ bufferView: 0, mimeType: "audio/wav" }] } }
    };
    const result = resolveEmbeddedClipBytes(json, binary, 0);
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([10, 20, 30, 40]));
  });

  it("resolves a bufferView-embedded clip whose OWN buffer carries a data: uri (no binary chunk needed)", () => {
    const bytes = new Uint8Array([5, 6, 7]);
    const dataUri = `data:application/octet-stream;base64,${base64Encode(bytes)}`;
    const json: GltfJsonShape = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 3 }],
      buffers: [{ uri: dataUri, byteLength: 3 }],
      extensions: { KHR_audio_emitter: { audio: [{ bufferView: 0 }] } }
    };
    const result = resolveEmbeddedClipBytes(json, null, 0);
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(bytes);
  });

  it("returns null for a uri-referenced (non-embedded) clip", () => {
    const json: GltfJsonShape = {
      extensions: { KHR_audio_emitter: { audio: [{ uri: "clips/a.wav" }] } }
    };
    expect(resolveEmbeddedClipBytes(json, null, 0)).toBeNull();
  });

  it("returns null when no binary chunk is available and the buffer has no data: uri of its own", () => {
    const json: GltfJsonShape = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      buffers: [{ byteLength: 4 }],
      extensions: { KHR_audio_emitter: { audio: [{ bufferView: 0 }] } }
    };
    expect(resolveEmbeddedClipBytes(json, null, 0)).toBeNull();
  });

  it("returns null for a nonexistent clip index", () => {
    const json: GltfJsonShape = { extensions: { KHR_audio_emitter: { audio: [] } } };
    expect(resolveEmbeddedClipBytes(json, null, 0)).toBeNull();
  });
});
