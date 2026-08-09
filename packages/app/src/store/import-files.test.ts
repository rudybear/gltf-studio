// Unit coverage for `importFiles` (TopBar's multi-select/drag-drop entry
// point, added to fix the reported "multi-file .gltf import shows the scene
// tree but renders no meshes" bug) and, since (UX-117) `importFiles` opens
// the missing-files dialog on the same failure `grantFolderAndRetryImport`
// resolves, that action too: a lone .glb still goes straight through
// `importGlb`; a .gltf among the selection gets packed via
// `packMultiFileGltf` first; a missing external reference fails the whole
// import with a toast naming it (UX-116) AND opens the missing-files dialog
// (UX-117), leaving whatever document was already open untouched (never a
// silent empty viewport) either way.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryHandleLike, FileHandleLike, FileLike } from "@gltf-studio/storage";

// `importOriginal` keeps `resolveUrisFromDirectory` real (app-store.ts's
// `grantFolderAndRetryImport` needs the genuine implementation) while still
// swapping out `IndexedDBStorage` for an in-memory double, same as before
// this file started needing anything else from the module.
vi.mock("@gltf-studio/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gltf-studio/storage")>();
  return {
    ...actual,
    IndexedDBStorage: class {
      capabilities = { fileHandles: false, remote: false };
      create = vi.fn(async (meta: { name: string; createdAt: string; updatedAt: string }) => ({ id: "proj-1", ...meta }));
      save = vi.fn(async () => {});
      autosaveJournal = vi.fn(async () => {});
    }
  };
});

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

/**
 * A minimal, flat, in-memory `DirectoryHandleLike` (fs-handle-types.ts) --
 * everything `resolveUrisFromDirectory`/`grantFolderAndRetryImport` actually
 * call (`keys()`, `getFileHandle()`) and nothing else, standing in for a
 * real `window.showDirectoryPicker()` handle without needing a browser.
 * Deliberately its own tiny double rather than reaching for
 * `packages/storage`'s own `MemoryDirectoryHandle` test shim (not part of
 * that package's public API/exports -- `directory-resolve.test.ts`, in the
 * same package, uses it directly; a real `showDirectoryPicker()` handle is
 * duck-typed against this exact interface either way).
 */
function fakeDirectoryHandle(files: Record<string, string | Uint8Array>): DirectoryHandleLike {
  const entries = new Map(
    Object.entries(files).map(([name, content]) => {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const file: FileLike = {
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
        async text() {
          return new TextDecoder().decode(bytes);
        }
      };
      return [name, file] as const;
    })
  );
  return {
    kind: "directory",
    name: "",
    async getFileHandle(name: string): Promise<FileHandleLike> {
      const file = entries.get(name);
      if (!file) throw new Error(`"${name}" not found.`);
      return { kind: "file", name, getFile: async () => file, createWritable: async () => { throw new Error("not implemented"); } };
    },
    async getDirectoryHandle(): Promise<DirectoryHandleLike> {
      throw new Error("no subdirectories in this fake");
    },
    async removeEntry() {},
    async *keys() {
      for (const name of entries.keys()) yield name;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ toasts: [], consoleLines: [], missingFilesDialog: null });
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

  it("also opens the missing-files dialog (UX-117), alongside the UX-116 toast, naming every unresolved reference", async () => {
    await useAppStore.getState().importFiles([fakeFile("scene.gltf", gltfWithExternalBufferAndAudio())]);

    const dialog = useAppStore.getState().missingFilesDialog;
    expect(dialog).not.toBeNull();
    expect(dialog!.gltfFile.name).toBe("scene.gltf");
    expect(dialog!.resolving).toBe(false);
    expect([...dialog!.missing].sort()).toEqual(["kick.mp3", "scene.bin"]);
    expect(dialog!.otherFiles.size).toBe(0); // nothing else was selected alongside the lone .gltf.
  });

  it("a successful pack does not leave a stale missing-files dialog open", async () => {
    useAppStore.setState({
      missingFilesDialog: {
        gltfFile: fakeFile("stale.gltf", "{}"),
        otherFiles: new Map(),
        missing: ["stale.bin"],
        resolving: false
      }
    });
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    await useAppStore.getState().importFiles([
      fakeFile("scene.gltf", gltfWithExternalBufferAndAudio()),
      fakeFile("scene.bin", new Uint8Array(positions.buffer)),
      fakeFile("kick.mp3", new Uint8Array([0xff, 0xfb, 1, 2, 3]))
    ]);
    expect(useAppStore.getState().missingFilesDialog).toBeNull();
  });
});

describe("closeMissingFilesDialog", () => {
  it("clears the dialog without importing anything", async () => {
    const before = useAppStore.getState().document;
    await useAppStore.getState().importFiles([fakeFile("scene.gltf", gltfWithExternalBufferAndAudio())]);
    expect(useAppStore.getState().missingFilesDialog).not.toBeNull();

    useAppStore.getState().closeMissingFilesDialog();
    expect(useAppStore.getState().missingFilesDialog).toBeNull();
    expect(useAppStore.getState().document).toBe(before); // untouched -- Cancel never imports anything.
  });
});

describe("grantFolderAndRetryImport (UX-117)", () => {
  it("resolves every missing reference from the granted directory and completes the import", async () => {
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    await useAppStore.getState().importFiles([fakeFile("scene.gltf", gltfWithExternalBufferAndAudio())]);
    expect(useAppStore.getState().missingFilesDialog).not.toBeNull();

    const dir = fakeDirectoryHandle({
      "scene.bin": new Uint8Array(positions.buffer),
      "kick.mp3": new Uint8Array([0xff, 0xfb, 1, 2, 3]),
      // An unrelated file also living in the same real folder -- must not
      // confuse resolution or leak into the packed document.
      "readme.txt": "not part of the asset"
    });

    await useAppStore.getState().grantFolderAndRetryImport(dir);

    expect(useAppStore.getState().missingFilesDialog).toBeNull();
    expect(useAppStore.getState().projectName).toBe("scene");
    const document = useAppStore.getState().document;
    expect(document).not.toBeNull();
    expect(document!.container.kind).toBe("glb");
  });

  it("an incomplete folder updates the dialog's missing list in place and keeps it open, rather than failing outright", async () => {
    const before = useAppStore.getState().document;
    await useAppStore.getState().importFiles([fakeFile("scene.gltf", gltfWithExternalBufferAndAudio())]);

    // Grants a folder with only ONE of the two missing files.
    const dir = fakeDirectoryHandle({ "scene.bin": new Uint8Array(36) });
    await useAppStore.getState().grantFolderAndRetryImport(dir);

    const dialog = useAppStore.getState().missingFilesDialog;
    expect(dialog).not.toBeNull(); // still open -- not closed/discarded on partial failure.
    expect(dialog!.missing).toEqual(["kick.mp3"]);
    expect(useAppStore.getState().document).toBe(before); // no partial import happened.
  });

  it("does nothing when no dialog is open (defensive -- should be unreachable from the UI)", async () => {
    const before = useAppStore.getState().document;
    await useAppStore.getState().grantFolderAndRetryImport(fakeDirectoryHandle({}));
    expect(useAppStore.getState().missingFilesDialog).toBeNull();
    expect(useAppStore.getState().document).toBe(before);
  });
});
