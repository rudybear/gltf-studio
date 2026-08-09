// Runs the shared StorageProvider contract (packages/contract-tests/src/storage-provider.ts,
// SP-001..020) against FileSystemAccessStorage, backed by `MemoryDirectoryHandle`
// (fs-test-shim.ts) — a minimal, hand-written in-memory stand-in for the
// browser File System Access API's `FileSystemDirectoryHandle`, implementing
// only the surface FileSystemAccessStorage actually calls (getDirectoryHandle/
// getFileHandle with `create`, removeEntry, keys(), a file handle's
// getFile()/createWritable(), queryPermission/requestPermission). It exists
// so this suite runs under plain Node with no browser and no
// `window.showDirectoryPicker()` user gesture.
import { describe, expect, it } from "vitest";
import { describeStorageProviderContract } from "@gltf-studio/contract-tests";
import { FileSystemAccessStorage } from "./filesystem-storage.js";
import { MemoryDirectoryHandle } from "./fs-test-shim.js";

describeStorageProviderContract(
  () => new FileSystemAccessStorage(new MemoryDirectoryHandle()),
  () => new FileSystemAccessStorage(new MemoryDirectoryHandle(), { quotaLimitBytes: 0 })
);

describe("FileSystemAccessStorage-specific", () => {
  it("capabilities.fileHandles is true (SP-013)", () => {
    const provider = new FileSystemAccessStorage(new MemoryDirectoryHandle());
    expect(provider.capabilities).toEqual({ fileHandles: true, remote: false });
  });

  it('a method rejects with a StorageError of kind "permission-revoked" when the root handle\'s permission has been revoked (SP-019)', async () => {
    const root = new MemoryDirectoryHandle();
    const provider = new FileSystemAccessStorage(root);
    const created = await provider.create({ name: "Revoked", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    root._setPermission("denied");

    await expect(provider.load(created.id)).rejects.toMatchObject({ kind: "permission-revoked" });
    await expect(
      provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar: null })
    ).rejects.toMatchObject({ kind: "permission-revoked" });
  });
});
