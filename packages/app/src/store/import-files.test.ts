// Unit coverage for `importFiles` (TopBar's multi-select/drag-drop entry
// point, added to fix the reported "multi-file .gltf import shows the scene
// tree but renders no meshes" bug): a lone .glb still goes straight through
// `importGlb`; a .gltf among the selection gets packed via
// `packMultiFileGltf` first; a missing external reference fails the whole
// import with a toast naming it, leaving whatever document was already open
// untouched (never a silent empty viewport).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@gltf-studio/storage", () => ({
  IndexedDBStorage: class {
    capabilities = { fileHandles: false, remote: false };
    create = vi.fn(async (meta: { name: string; createdAt: string; updatedAt: string }) => ({ id: "proj-1", ...meta }));
    save = vi.fn(async () => {});
    autosaveJournal = vi.fn(async () => {});
  }
}));

const { useAppStore } = await import("./app-store.js");

function fakeFile(name: string, content: string | Uint8Array): { name: string; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    }
  };
}

function gltfWithExternalBufferAndAudio(): string {
  return JSON.stringify({
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
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ toasts: [], consoleLines: [] });
});

describe("importFiles", () => {
  it("a lone .glb goes straight through the normal single-file import path", async () => {
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]); // truncated/invalid GLB on purpose
    await useAppStore.getState().importFiles([fakeFile("thing.glb", glbBytes)]);
    // parseContainer will throw on this deliberately-truncated GLB -- the
    // point of this test is only that importFiles routed a single non-.gltf
    // file straight to importGlb (which then reports the parse failure),
    // not that a truncated fixture successfully imports.
    expect(useAppStore.getState().toasts[0]?.text).toMatch(/Import failed/);
  });

  it("packs a .gltf + external .bin + external KHR_audio_emitter .mp3 into one self-contained document", async () => {
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    const files = [
      fakeFile("scene.gltf", gltfWithExternalBufferAndAudio()),
      fakeFile("scene.bin", new Uint8Array(positions.buffer)),
      fakeFile("kick.mp3", new Uint8Array([0xff, 0xfb, 1, 2, 3]))
    ];

    await useAppStore.getState().importFiles(files);

    expect(useAppStore.getState().toasts).toHaveLength(0);
    expect(useAppStore.getState().projectName).toBe("scene");
    const document = useAppStore.getState().document;
    expect(document).not.toBeNull();
    expect(document!.container.kind).toBe("glb");

    // Round-trips through the real container parser: exactly one embedded
    // buffer (no uri), audio entry now bufferView-based.
    const json = document!.json as {
      buffers: Array<{ uri?: string }>;
      extensions: { KHR_audio_emitter: { audio: Array<{ uri?: string; bufferView?: number }> } };
    };
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri).toBeUndefined();
    expect(json.extensions.KHR_audio_emitter.audio[0].uri).toBeUndefined();
    expect(typeof json.extensions.KHR_audio_emitter.audio[0].bufferView).toBe("number");
  });

  it("fails loudly (toast naming every missing file) and leaves the current document untouched when a .gltf's sibling is missing", async () => {
    const before = useAppStore.getState().document;
    await useAppStore.getState().importFiles([fakeFile("scene.gltf", gltfWithExternalBufferAndAudio())]);

    expect(useAppStore.getState().document).toBe(before); // untouched -- no partial/empty import.
    expect(useAppStore.getState().toasts).toHaveLength(1);
    const text = useAppStore.getState().toasts[0]!.text;
    expect(text).toContain("scene.bin");
    expect(text).toContain("kick.mp3");
    expect(text).toContain("scene.gltf");
  });
});
