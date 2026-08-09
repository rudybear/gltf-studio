import { describe, expect, it } from "vitest";
import { parseContainer } from "@gltfi/gltf";
import { packMultiFileGltf, type PackFileMap } from "./pack-gltf.js";

function fileOf(bytes: Uint8Array | string): { arrayBuffer(): Promise<ArrayBuffer> } {
  const asBytes = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    async arrayBuffer() {
      return asBytes.buffer.slice(asBytes.byteOffset, asBytes.byteOffset + asBytes.byteLength) as ArrayBuffer;
    }
  };
}

/** A minimal, real .gltf shape mirroring drum-kit.gltf's structure: one external .bin (positions) plus one KHR_audio_emitter audio entry backed by an external .mp3-ish blob. */
function buildGltfJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Root", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri: "scene.bin", byteLength: 36 }],
    extensionsUsed: ["KHR_audio_emitter"],
    extensions: {
      KHR_audio_emitter: {
        audio: [{ uri: "kick.mp3", mimeType: "audio/mpeg" }],
        sources: [{ audio: 0, gain: 1 }],
        emitters: [{ type: "global", gain: 1, sources: [0] }]
      }
    }
  };
}

describe("packMultiFileGltf", () => {
  it("packs external buffer + external KHR_audio_emitter audio into one self-contained GLB", async () => {
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    const binBytes = new Uint8Array(positions.buffer);
    const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]); // arbitrary opaque bytes; content doesn't matter for packing.

    const fileMap: PackFileMap = new Map([
      ["scene.bin", fileOf(binBytes)],
      ["kick.mp3", fileOf(mp3Bytes)]
    ]);

    const result = await packMultiFileGltf(buildGltfJson(), fileMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const container = parseContainer(result.bytes);
    expect(container.kind).toBe("glb");
    if (container.kind !== "glb") return;

    const json = container.json as {
      buffers: Array<{ uri?: string; byteLength: number }>;
      bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number }>;
      extensions: { KHR_audio_emitter: { audio: Array<{ uri?: string; bufferView?: number; mimeType?: string }> } };
    };

    // Exactly one buffer left (the consolidated one), no uri (GLB-embedded).
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri).toBeUndefined();

    // Original bufferView (POSITION) still resolves, now against the consolidated buffer.
    expect(json.bufferViews[0].buffer).toBe(0);
    expect(json.bufferViews[0].byteLength).toBe(36);

    // A new bufferView was appended for the audio, uri replaced by bufferView.
    const audio = json.extensions.KHR_audio_emitter.audio[0];
    expect(audio.uri).toBeUndefined();
    expect(audio.mimeType).toBe("audio/mpeg");
    expect(typeof audio.bufferView).toBe("number");
    const audioView = json.bufferViews[audio.bufferView!];
    expect(audioView.byteLength).toBe(mp3Bytes.length);

    // The BIN chunk actually contains both segments' real bytes (round-trips through the container).
    expect(container.binaryChunk).toBeDefined();
    const bin = new Uint8Array(container.binaryChunk!);
    const posView = json.bufferViews[0];
    expect(new Float32Array(bin.slice(posView.byteOffset, posView.byteOffset + posView.byteLength).buffer)).toEqual(positions);
    expect(bin.slice(audioView.byteOffset, audioView.byteOffset + audioView.byteLength)).toEqual(mp3Bytes);
  });

  it("reports every missing external reference without producing bytes", async () => {
    const fileMap: PackFileMap = new Map(); // neither scene.bin nor kick.mp3 supplied.
    const result = await packMultiFileGltf(buildGltfJson(), fileMap);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing.sort()).toEqual(["kick.mp3", "scene.bin"]);
  });

  it("leaves data: URI buffers untouched and still wraps the result as a GLB container", async () => {
    const json = {
      asset: { version: "2.0" },
      buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 }],
      bufferViews: [],
      extensionsUsed: []
    };
    const result = await packMultiFileGltf(json, new Map());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const container = parseContainer(result.bytes);
    expect(container.kind).toBe("glb");
    if (container.kind !== "glb") return;
    const outJson = container.json as { buffers: Array<{ uri?: string }> };
    expect(outJson.buffers[0].uri).toBe("data:application/octet-stream;base64,AAAA");
  });

  it("resolves a percent-encoded / ./-prefixed uri against a plain-basename file map entry", async () => {
    const json = {
      asset: { version: "2.0" },
      buffers: [{ uri: "./My%20Scene.bin", byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }]
    };
    const fileMap: PackFileMap = new Map([["My Scene.bin", fileOf(new Uint8Array([1, 2, 3, 4]))]]);
    const result = await packMultiFileGltf(json, fileMap);
    expect(result.ok).toBe(true);
  });
});
