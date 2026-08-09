// FileSystemAccessStorage: the opt-in local-file-backed StorageProvider
// (SP-001, SP-013 `capabilities.fileHandles: true`). Persists each project
// as a subdirectory of `projects/` under the given root directory handle:
//
//   <root>/projects/<id>/meta.json       ProjectMeta minus the thumbnail bytes
//   <root>/projects/<id>/thumbnail.bin   present only if meta.thumbnail was set
//   <root>/projects/<id>/container.bin   data.container, byte for byte (SP-008)
//   <root>/projects/<id>/sidecar.json    JSON.stringify(data.sidecar) (SP-009)
//   <root>/projects/<id>/journal.json    { sinceRev, patches } (SP-004/014); absent = empty journal
//
// `root` is a `DirectoryHandleLike` (fs-handle-types.ts) rather than the
// real DOM `FileSystemDirectoryHandle` type (TypeScript's bundled `dom` lib
// does not declare the File System Access API) — see that file's header for
// why a real `window.showDirectoryPicker()` handle is still a drop-in fit.
import type { JsonPatchOp, ProjectData, ProjectMeta, StorageCapabilities, StorageProvider } from "@gltf-studio/engine-api";
import type { DirectoryHandleLike, FileHandleLike } from "./fs-handle-types.js";
import { isPermissionDomError, isQuotaDomError, notFoundError, permissionRevokedError, quotaExceededError } from "./errors.js";
import { toArrayBuffer } from "./bytes.js";

const PROJECTS_DIR = "projects";

interface StoredMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
  thumbnailType?: string;
}

export interface FileSystemAccessStorageOptions {
  /**
   * Test/defense-in-depth seam: see `IndexedDBStorageOptions.quotaLimitBytes`
   * — same semantics, checked before any file is written.
   */
  quotaLimitBytes?: number;
}

export class FileSystemAccessStorage implements StorageProvider {
  readonly capabilities: StorageCapabilities = { fileHandles: true, remote: false };

  #root: DirectoryHandleLike;
  #quotaLimitBytes: number | undefined;

  constructor(root: DirectoryHandleLike, options: FileSystemAccessStorageOptions = {}) {
    this.#root = root;
    this.#quotaLimitBytes = options.quotaLimitBytes;
  }

  async listProjects(): Promise<ProjectMeta[]> {
    await this.#checkPermission();
    const projectsDir = await this.#projectsDir();
    const metas: ProjectMeta[] = [];
    for await (const name of projectsDir.keys()) {
      const meta = await this.#tryReadMeta(projectsDir, name);
      if (meta) metas.push(meta);
    }
    return metas;
  }

  async create(meta: Omit<ProjectMeta, "id">): Promise<ProjectMeta> {
    await this.#checkPermission();
    const id = generateId();
    const fullMeta: ProjectMeta = { id, name: meta.name, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
    if (meta.thumbnail) fullMeta.thumbnail = meta.thumbnail;

    const projectsDir = await this.#projectsDir();
    const dir = await projectsDir.getDirectoryHandle(id, { create: true });
    await this.#writeMeta(dir, fullMeta);
    await this.#writeFile(dir, "container.bin", new Uint8Array(0));
    await this.#writeFile(dir, "sidecar.json", JSON.stringify(null));
    return fullMeta;
  }

  async load(id: string): Promise<ProjectData> {
    await this.#checkPermission();
    const dir = await this.#getProjectDir(id);
    if (!dir) throw notFoundError(id);

    const meta = await this.#tryReadMeta(await this.#projectsDir(), id);
    if (!meta) throw notFoundError(id);

    const containerBytes = await this.#readFileBytes(dir, "container.bin");
    const sidecarText = await this.#readFileText(dir, "sidecar.json");

    return {
      meta,
      container: containerBytes ?? new Uint8Array(0),
      sidecar: sidecarText !== undefined ? JSON.parse(sidecarText) : null
    };
  }

  async save(id: string, data: ProjectData): Promise<void> {
    await this.#checkPermission();
    const sidecarText = JSON.stringify(data.sidecar);
    const sidecarSize = new TextEncoder().encode(sidecarText).length;
    if (this.#quotaLimitBytes !== undefined && data.container.byteLength + sidecarSize > this.#quotaLimitBytes) {
      throw quotaExceededError();
    }

    const projectsDir = await this.#projectsDir();
    const dir = await projectsDir.getDirectoryHandle(id, { create: true });
    await this.#writeMeta(dir, data.meta);
    await this.#writeFile(dir, "container.bin", data.container);
    await this.#writeFile(dir, "sidecar.json", sidecarText);
    // SP-016: a successful save clears the project's journal.
    await dir.removeEntry("journal.json").catch(() => undefined);
  }

  async autosaveJournal(id: string, sinceRev: number, patches: JsonPatchOp[]): Promise<void> {
    await this.#checkPermission();
    const projectsDir = await this.#projectsDir();
    const dir = await projectsDir.getDirectoryHandle(id, { create: true });
    const existingText = await this.#readFileText(dir, "journal.json");
    const existing: { sinceRev: number; patches: JsonPatchOp[] } | undefined = existingText
      ? JSON.parse(existingText)
      : undefined;
    const record = existing
      ? { sinceRev: existing.sinceRev, patches: [...existing.patches, ...patches] }
      : { sinceRev, patches: [...patches] };
    await this.#writeFile(dir, "journal.json", JSON.stringify(record));
  }

  async loadJournal(id: string): Promise<{ sinceRev: number; patches: JsonPatchOp[] }> {
    await this.#checkPermission();
    const dir = await this.#getProjectDir(id);
    if (!dir) return { sinceRev: 0, patches: [] };
    const text = await this.#readFileText(dir, "journal.json");
    if (!text) return { sinceRev: 0, patches: [] };
    return JSON.parse(text);
  }

  // ---------------------------------------------------------------------
  // File System Access plumbing
  // ---------------------------------------------------------------------

  async #checkPermission(): Promise<void> {
    if (!this.#root.queryPermission) return;
    const state = await this.#root.queryPermission({ mode: "readwrite" });
    if (state === "denied") throw permissionRevokedError();
  }

  async #projectsDir(): Promise<DirectoryHandleLike> {
    return this.#root.getDirectoryHandle(PROJECTS_DIR, { create: true });
  }

  async #getProjectDir(id: string): Promise<DirectoryHandleLike | undefined> {
    try {
      const projectsDir = await this.#projectsDir();
      return await projectsDir.getDirectoryHandle(id, { create: false });
    } catch {
      return undefined;
    }
  }

  async #tryReadMeta(projectsDir: DirectoryHandleLike, id: string): Promise<ProjectMeta | undefined> {
    try {
      const dir = await projectsDir.getDirectoryHandle(id, { create: false });
      const text = await this.#readFileText(dir, "meta.json");
      if (!text) return undefined;
      const stored: StoredMeta = JSON.parse(text);
      const meta: ProjectMeta = { id: stored.id, name: stored.name, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
      if (stored.hasThumbnail) {
        const thumbBytes = await this.#readFileBytes(dir, "thumbnail.bin");
        if (thumbBytes) {
          meta.thumbnail = new Blob([toArrayBuffer(thumbBytes)], { type: stored.thumbnailType ?? "application/octet-stream" });
        }
      }
      return meta;
    } catch {
      return undefined;
    }
  }

  async #writeMeta(dir: DirectoryHandleLike, meta: ProjectMeta): Promise<void> {
    const stored: StoredMeta = {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      hasThumbnail: Boolean(meta.thumbnail)
    };
    if (meta.thumbnail) {
      stored.thumbnailType = meta.thumbnail.type;
      await this.#writeFile(dir, "thumbnail.bin", new Uint8Array(await meta.thumbnail.arrayBuffer()));
    }
    await this.#writeFile(dir, "meta.json", JSON.stringify(stored));
  }

  async #writeFile(dir: DirectoryHandleLike, name: string, data: Uint8Array | string): Promise<void> {
    let handle: FileHandleLike;
    try {
      handle = await dir.getFileHandle(name, { create: true });
    } catch (error) {
      throw mapFsError(error);
    }
    try {
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async #readFileBytes(dir: DirectoryHandleLike, name: string): Promise<Uint8Array | undefined> {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return undefined;
    }
  }

  async #readFileText(dir: DirectoryHandleLike, name: string): Promise<string | undefined> {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return undefined;
    }
  }
}

function mapFsError(error: unknown): Error {
  if (isQuotaDomError(error)) return quotaExceededError(error);
  if (isPermissionDomError(error)) return permissionRevokedError(error);
  return error instanceof Error ? error : new Error(String(error));
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
