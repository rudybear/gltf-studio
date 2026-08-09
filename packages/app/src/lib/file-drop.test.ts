// Unit coverage for `filesFromDataTransfer` (file-drop.ts, UX-118): a
// dropped folder's full tree resolves to a flat `File[]` via
// `webkitGetAsEntry`/directory-reader traversal; a plain flat multi-file
// drop (no directory entries, or a browser without the extension) falls
// back to `DataTransfer.files` unchanged. Fakes the File and Directory
// Entries API surface directly (jsdom doesn't implement it, and this suite
// runs under plain Node -- see `vitest.config.ts`'s `environment: "node"`)
// via minimal structural doubles cast through `unknown`, since none of these
// fakes need every real interface member (`FileSystemEntry.filesystem`/
// `fullPath`/`getParent()`, etc.) -- the app's actual drop handlers
// (TopBar.tsx, App.tsx) are covered by the browser-mode e2e that dispatches
// a real synthetic drop event.
import { describe, expect, it } from "vitest";
import { filesFromDataTransfer } from "./file-drop.js";

function fakeFileEntry(file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file(success: (f: File) => void) {
      success(file);
    }
  } as unknown as FileSystemFileEntry;
}

function fakeDirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  let read = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader(): FileSystemDirectoryReader {
      return {
        readEntries(success: (entries: FileSystemEntry[]) => void) {
          // Real `readEntries` must be called repeatedly until it returns an
          // empty array -- return the full batch once, then empty forever
          // after, exercising that contract.
          if (read) {
            success([]);
            return;
          }
          read = true;
          success(children);
        }
      } as unknown as FileSystemDirectoryReader;
    }
  } as unknown as FileSystemDirectoryEntry;
}

function fakeDataTransfer(entries: FileSystemEntry[] | null, flatFiles: File[]): DataTransfer {
  const items = entries
    ? entries.map((entry) => ({ webkitGetAsEntry: () => entry }) as unknown as DataTransferItem)
    : flatFiles.map(() => ({ webkitGetAsEntry: () => null }) as unknown as DataTransferItem);
  return {
    items: items as unknown as DataTransferItemList,
    files: flatFiles as unknown as FileList
  } as unknown as DataTransfer;
}

describe("filesFromDataTransfer", () => {
  it("returns a flat multi-file drop's files unchanged when every item resolves to a (non-directory) file entry", async () => {
    const files = [new File(["a"], "scene.gltf"), new File(["b"], "scene.bin")];
    const dt = fakeDataTransfer(
      files.map((f) => fakeFileEntry(f)),
      files
    );
    const result = await filesFromDataTransfer(dt);
    expect(result.map((f) => f.name).sort()).toEqual(["scene.bin", "scene.gltf"]);
  });

  it("traverses a dropped folder's full tree via webkitGetAsEntry, including a nested subdirectory", async () => {
    const gltf = new File(["gltf"], "scene.gltf");
    const bin = new File(["bin"], "scene.bin");
    const png = new File(["png"], "diffuse.png");
    const texturesDir = fakeDirEntry("textures", [fakeFileEntry(png)]);
    const rootDir = fakeDirEntry("drum-kit", [fakeFileEntry(gltf), fakeFileEntry(bin), texturesDir]);

    const dt = fakeDataTransfer([rootDir], []);
    const result = await filesFromDataTransfer(dt);
    expect(result.map((f) => f.name).sort()).toEqual(["diffuse.png", "scene.bin", "scene.gltf"]);
  });

  it("falls back to DataTransfer.files when webkitGetAsEntry isn't supported at all", async () => {
    const files = [new File(["a"], "thing.glb")];
    const dt = fakeDataTransfer(null, files);
    const result = await filesFromDataTransfer(dt);
    expect(result.map((f) => f.name)).toEqual(["thing.glb"]);
  });
});
