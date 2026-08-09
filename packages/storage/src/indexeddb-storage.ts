// IndexedDBStorage: the default StorageProvider (SP-001). Works against the
// real browser `indexedDB` global, or an injected `IDBFactory` (the app's
// unit/contract tests inject `fake-indexeddb` under Node — see
// indexeddb-storage.test.ts).
import type { JsonPatchOp, ProjectData, ProjectMeta, StorageCapabilities, StorageProvider } from "@gltf-studio/engine-api";
import { isQuotaDomError, notFoundError, quotaExceededError, StorageErrorImpl } from "./errors.js";
import { toArrayBuffer } from "./bytes.js";

const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const JOURNALS_STORE = "journals";

interface StoredThumbnail {
  buffer: ArrayBuffer;
  type: string;
}

interface StoredProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: StoredThumbnail;
  container: ArrayBuffer;
  sidecar: unknown;
}

interface StoredJournalRecord {
  id: string;
  sinceRev: number;
  patches: JsonPatchOp[];
}

export interface IndexedDBStorageOptions {
  /** Database name; defaults to "gltf-studio". Tests may vary this to isolate suites. */
  dbName?: string;
  /** Injectable IDBFactory (e.g. `fake-indexeddb`'s under Node); defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  /**
   * Test/defense-in-depth seam: when set, `save()` rejects with a
   * quota-exceeded StorageError up front if the combined encoded size of
   * `container` + `sidecar` would exceed this many bytes, without touching
   * the real backend. Real backend QuotaExceededError DOMExceptions are
   * also caught and mapped (see `#putProject`) independent of this option.
   */
  quotaLimitBytes?: number;
}

export class IndexedDBStorage implements StorageProvider {
  readonly capabilities: StorageCapabilities = { fileHandles: false, remote: false };

  #dbName: string;
  #idb: IDBFactory;
  #quotaLimitBytes: number | undefined;
  #dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDBStorageOptions = {}) {
    this.#dbName = options.dbName ?? "gltf-studio";
    const factory = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      throw new Error(
        "IndexedDBStorage: no IDBFactory available. Pass { indexedDB } explicitly (e.g. fake-indexeddb under Node)."
      );
    }
    this.#idb = factory;
    this.#quotaLimitBytes = options.quotaLimitBytes;
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const db = await this.#openDb();
    const records = await this.#getAll<StoredProjectRecord>(db, PROJECTS_STORE);
    return records.map(recordToMeta);
  }

  async create(meta: Omit<ProjectMeta, "id">): Promise<ProjectMeta> {
    const id = generateId();
    const fullMeta: ProjectMeta = { id, name: meta.name, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
    if (meta.thumbnail) fullMeta.thumbnail = meta.thumbnail;

    const record: StoredProjectRecord = {
      id,
      name: fullMeta.name,
      createdAt: fullMeta.createdAt,
      updatedAt: fullMeta.updatedAt,
      thumbnail: await toStoredThumbnail(fullMeta.thumbnail),
      container: new ArrayBuffer(0),
      sidecar: null
    };

    const db = await this.#openDb();
    await this.#put(db, PROJECTS_STORE, record);
    return fullMeta;
  }

  async load(id: string): Promise<ProjectData> {
    const db = await this.#openDb();
    const record = await this.#get<StoredProjectRecord>(db, PROJECTS_STORE, id);
    if (!record) throw notFoundError(id);
    return recordToProjectData(record);
  }

  async save(id: string, data: ProjectData): Promise<void> {
    const containerBuffer = toArrayBuffer(data.container);
    const sidecarSize = sizeOfJson(data.sidecar);
    if (this.#quotaLimitBytes !== undefined && containerBuffer.byteLength + sidecarSize > this.#quotaLimitBytes) {
      throw quotaExceededError();
    }

    const record: StoredProjectRecord = {
      id,
      name: data.meta.name,
      createdAt: data.meta.createdAt,
      updatedAt: data.meta.updatedAt,
      thumbnail: await toStoredThumbnail(data.meta.thumbnail),
      container: containerBuffer,
      sidecar: data.sidecar
    };

    const db = await this.#openDb();
    await this.#put(db, PROJECTS_STORE, record);
    // SP-016: a successful save clears the project's journal.
    await this.#delete(db, JOURNALS_STORE, id);
  }

  async autosaveJournal(id: string, sinceRev: number, patches: JsonPatchOp[]): Promise<void> {
    const db = await this.#openDb();
    const existing = await this.#get<StoredJournalRecord>(db, JOURNALS_STORE, id);
    const record: StoredJournalRecord = existing
      ? { id, sinceRev: existing.sinceRev, patches: [...existing.patches, ...patches] }
      : { id, sinceRev, patches: [...patches] };
    await this.#put(db, JOURNALS_STORE, record);
  }

  async loadJournal(id: string): Promise<{ sinceRev: number; patches: JsonPatchOp[] }> {
    const db = await this.#openDb();
    const existing = await this.#get<StoredJournalRecord>(db, JOURNALS_STORE, id);
    if (!existing) return { sinceRev: 0, patches: [] };
    return { sinceRev: existing.sinceRev, patches: existing.patches };
  }

  // ---------------------------------------------------------------------
  // IndexedDB plumbing
  // ---------------------------------------------------------------------

  #openDb(): Promise<IDBDatabase> {
    if (!this.#dbPromise) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const req = this.#idb.open(this.#dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
          if (!db.objectStoreNames.contains(JOURNALS_STORE)) db.createObjectStore(JOURNALS_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDBStorage: failed to open database."));
      });
    }
    return this.#dbPromise;
  }

  #getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  #get<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  #put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      let putError: unknown;
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        putError = (event.target as IDBRequest | null)?.error ?? tx.error;
      };
      tx.onabort = () => reject(mapWriteError(putError ?? tx.error));
    });
  }

  #delete(db: IDBDatabase, store: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

function mapWriteError(error: unknown): Error {
  if (isQuotaDomError(error)) return quotaExceededError(error);
  if (error instanceof Error) return error;
  return new StorageErrorImpl("quota-exceeded", "IndexedDB write failed.", { cause: error });
}

function recordToMeta(record: StoredProjectRecord): ProjectMeta {
  const meta: ProjectMeta = { id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt };
  if (record.thumbnail) meta.thumbnail = new Blob([record.thumbnail.buffer], { type: record.thumbnail.type });
  return meta;
}

function recordToProjectData(record: StoredProjectRecord): ProjectData {
  return {
    meta: recordToMeta(record),
    container: new Uint8Array(record.container),
    sidecar: record.sidecar
  };
}

async function toStoredThumbnail(thumbnail: Blob | undefined): Promise<StoredThumbnail | undefined> {
  if (!thumbnail) return undefined;
  return { buffer: await thumbnail.arrayBuffer(), type: thumbnail.type };
}

function sizeOfJson(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return 0;
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
