// Minimal in-memory implementation of `DirectoryHandleLike`
// (fs-handle-types.ts) — a tiny stand-in for the browser File System Access
// API's `FileSystemDirectoryHandle`, used only by tests
// (indexeddb-storage.test.ts's sibling filesystem-storage.test.ts, and the
// shared StorageProvider contract run against `FileSystemAccessStorage`) so
// they don't need a real browser or `window.showDirectoryPicker()` user
// gesture. It implements exactly the surface `FileSystemAccessStorage`
// calls: getDirectoryHandle/getFileHandle (with `create`), removeEntry,
// keys(), a file handle's getFile()/createWritable(), and
// queryPermission()/requestPermission() plus a test-only `_setPermission`
// hook for simulating SP-019's "permission revoked" case.
import type { DirectoryHandleLike, FileHandleLike, FileLike, PermissionState, WritableFileStreamLike } from "./fs-handle-types.js";

type Entry = MemoryDirectoryHandle | MemoryFileHandle;

class NotFoundDomError extends Error {
  readonly name = "NotFoundError";
}

export class MemoryFileHandle implements FileHandleLike {
  readonly kind = "file" as const;
  #dir: MemoryDirectoryHandle;

  constructor(
    readonly name: string,
    dir: MemoryDirectoryHandle,
    private bytes: Uint8Array = new Uint8Array(0)
  ) {
    this.#dir = dir;
  }

  async getFile(): Promise<FileLike> {
    const bytes = this.bytes;
    return {
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
      async text() {
        return new TextDecoder().decode(bytes);
      }
    };
  }

  async createWritable(): Promise<WritableFileStreamLike> {
    if (this.#dir.permission === "denied") {
      const err = new Error("Permission to write was denied.");
      (err as { name?: string }).name = "NotAllowedError";
      throw err;
    }
    const chunks: Uint8Array[] = [];
    const dir = this.#dir;
    return {
      write: async (data: Uint8Array | string) => {
        chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      },
      close: async () => {
        const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        if (dir.quotaLimitBytes !== undefined && total > dir.quotaLimitBytes) {
          const err = new Error("Quota exceeded.");
          (err as { name?: string }).name = "QuotaExceededError";
          throw err;
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        this.bytes = merged;
      }
    };
  }
}

export class MemoryDirectoryHandle implements DirectoryHandleLike {
  readonly kind = "directory" as const;
  #entries = new Map<string, Entry>();
  permission: PermissionState = "granted";
  /** Test-only: when set, writes whose total bytes exceed this reject with a QuotaExceededError-shaped error. */
  quotaLimitBytes: number | undefined;

  constructor(readonly name: string = "") {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike> {
    const existing = this.#entries.get(name);
    if (existing) {
      if (existing.kind !== "directory") throw new Error(`"${name}" exists and is not a directory.`);
      return existing;
    }
    if (!options?.create) throw new NotFoundDomError(`Directory "${name}" not found.`);
    const dir = new MemoryDirectoryHandle(name);
    dir.quotaLimitBytes = this.quotaLimitBytes;
    this.#entries.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    const existing = this.#entries.get(name);
    if (existing) {
      if (existing.kind !== "file") throw new Error(`"${name}" exists and is not a file.`);
      return existing;
    }
    if (!options?.create) throw new NotFoundDomError(`File "${name}" not found.`);
    const file = new MemoryFileHandle(name, this);
    this.#entries.set(name, file);
    return file;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    void options;
    if (!this.#entries.has(name)) throw new NotFoundDomError(`"${name}" not found.`);
    this.#entries.delete(name);
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.#entries.keys()) yield name;
  }

  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    return this.permission;
  }

  /** Test-only: simulate a previously-granted handle whose permission was revoked (SP-019). */
  _setPermission(state: PermissionState): void {
    this.permission = state;
  }
}
