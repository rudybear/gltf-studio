// A minimal structural subset of the browser File System Access API that
// `FileSystemAccessStorage` needs. Defined locally (rather than pulling in
// `lib.dom`'s real `FileSystemDirectoryHandle`/`showDirectoryPicker`, which
// TypeScript's bundled DOM lib does not include) so:
//   1. the app can pass a real handle from `window.showDirectoryPicker()`
//      (cast through this interface — the real handle is structurally
//      compatible: `File` has `arrayBuffer()`/`text()`,
//      `FileSystemWritableFileStream` has `write()`/`close()`), and
//   2. tests can pass an in-memory shim (see fs-test-shim.ts) with no
//      browser/DOM environment at all.
export type PermissionState = "granted" | "denied" | "prompt";

export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface WritableFileStreamLike {
  // Narrower than the real `FileSystemWritableFileStream.write()` (which
  // also accepts `BufferSource | Blob`) because `FileSystemAccessStorage`
  // only ever calls it with a `Uint8Array` or a `string` — a real handle's
  // wider parameter type is still structurally assignable here since it
  // accepts a superset of what we pass.
  write(data: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableFileStreamLike>;
}

export interface DirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterableIterator<string>;
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}
