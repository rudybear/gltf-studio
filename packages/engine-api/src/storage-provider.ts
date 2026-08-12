import type { JsonPatchOp } from "./json-patch.js";
import type { ProjectData, ProjectMeta } from "./value-types.js";

/** SP-013: exactly these two flags, no open-ended map. */
export interface StorageCapabilities {
  fileHandles: boolean;
  remote: boolean;
}

/**
 * SP-017..SP-020: a typed error every StorageProvider method may reject
 * with, so callers branch on `kind` rather than string-matching messages.
 */
export type StorageErrorKind = "quota-exceeded" | "not-found" | "permission-revoked";

/** SP-020. */
export interface StorageError extends Error {
  kind: StorageErrorKind;
}

/**
 * StorageProvider: SP-001. All persistence goes through this interface so
 * auth/cloud/sharing arrive without editor rework. Implementations today:
 * IndexedDB, File System Access. Later: HTTP.
 */
export interface StorageProvider {
  /** SP-022: ordered by `updatedAt` descending (most-recently-updated project first) — resolves the "recent ordering" open question for the project-manager's "open recent" list. */
  listProjects(): Promise<ProjectMeta[]>;

  /** SP-005/SP-006: the provider assigns and stabilizes the returned id. */
  create(meta: Omit<ProjectMeta, "id">): Promise<ProjectMeta>;

  /** SP-018: rejects with a StorageError of kind "not-found" for an unknown id. */
  load(id: string): Promise<ProjectData>;

  /**
   * SP-008/SP-009/SP-010: writes `data.container` (exactly the
   * `writeContainer` byte output) and `data.sidecar` together in one call;
   * a subsequent `load(id)` round-trips both. SP-017: rejects with a
   * StorageError of kind "quota-exceeded" when the backend refuses the
   * write on quota grounds; SP-019: kind "permission-revoked" for a
   * File-System-Access handle whose permission was revoked.
   */
  save(id: string, data: ProjectData): Promise<void>;

  /**
   * SP-004/SP-014: append-only within a rev-window, doubling as the future
   * backend sync wire format per Phase A. SP-016: a successful save(id)
   * clears the journal for that project. Takes `id` (added post-M0: the
   * original seeded signature omitted it, but a per-project append-only
   * journal cannot be addressed without one — see specs/storage-provider.md's
   * SP-004/SP-014 note) so the journal is scoped to the same project
   * `loadJournal(id)` reads back.
   */
  autosaveJournal(id: string, sinceRev: number, patches: JsonPatchOp[]): Promise<void>;

  /** SP-015: replay = load(id) (the base) + apply `patches` in order. */
  loadJournal(id: string): Promise<{ sinceRev: number; patches: JsonPatchOp[] }>;

  /**
   * SP-021: removes the project (and, per SP-016's own "a successful write
   * clears the journal" spirit, its journal too, if any) so neither a
   * subsequent `listProjects()` nor `load(id)` sees it again — `load(id)`
   * on a deleted id rejects with SP-018's "not-found" `StorageError`, same
   * as an id that was never `create()`d. Added for the project-manager's
   * delete action (specs/ux-shell.md UX-122); idempotent — deleting an
   * already-deleted/unknown id resolves rather than rejecting, since the
   * caller's desired end state ("this id has no project") already holds.
   */
  delete(id: string): Promise<void>;

  readonly capabilities: StorageCapabilities;
}
