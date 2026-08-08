import type { JsonPatchOp } from "./json-patch.js";
import type { ProjectData, ProjectMeta } from "./value-types.js";

// OPEN(SP-capabilities-shape-tbd): plan says "capabilities flags" without
// enumerating which flags (e.g. supports a journal, supports multi-file
// .gltf, supports concurrent writers). Left as an open boolean map.
export type StorageCapabilities = Record<string, boolean>;

/**
 * StorageProvider: SP-001. All persistence goes through this interface so
 * auth/cloud/sharing arrive without editor rework. Implementations today:
 * IndexedDB, File System Access. Later: HTTP.
 */
export interface StorageProvider {
  listProjects(): Promise<ProjectMeta[]>;

  // OPEN(SP-create-signature-tbd): plan does not specify create()'s input;
  // an id-less ProjectMeta is the minimal reasonable reading (the provider
  // assigns the id).
  create(meta: Omit<ProjectMeta, "id">): Promise<ProjectMeta>;

  load(id: string): Promise<ProjectData>;

  // OPEN(SP-save-signature-tbd): Phase A's "dirty-root save" describes
  // saving only changed roots via locateJsonSpan/applyEdits, an
  // editor-core/RenderHost-adjacent concern; whether that maps onto this
  // interface as a whole-ProjectData save (as modeled here) or a
  // patch-shaped save is not specified at the engine-api layer.
  save(id: string, data: ProjectData): Promise<void>;

  /**
   * SP-004: autosaveJournal is patch-shaped (RFC 6902), doubling as the
   * future backend sync wire format per Phase A.
   */
  autosaveJournal(sinceRev: number, patches: JsonPatchOp[]): Promise<void>;

  // OPEN(SP-loadjournal-shape-tbd): plan says loadJournal exists for crash
  // recovery ("crash recovery ≡ sync protocol") but does not specify its
  // return shape beyond "the same patch-journal concept" as
  // autosaveJournal's input.
  loadJournal(id: string): Promise<{ sinceRev: number; patches: JsonPatchOp[] }>;

  readonly capabilities: StorageCapabilities;
}
