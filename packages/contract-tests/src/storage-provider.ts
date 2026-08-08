import { describe, it } from "vitest";
import type { StorageProvider } from "@gltf-studio/engine-api";

/**
 * StorageProvider contract obligations, transcribed from Phase A. Both
 * planned implementations (IndexedDB, File System Access) must pass this
 * suite before the app registers them.
 */
export const storageProviderContractObligations: string[] = [
  "listProjects returns an empty array for a fresh provider (SP-001)",
  "create assigns an id and the project is then visible in listProjects (SP-001)",
  "create never returns the same id twice across calls on the same provider instance (SP-005)",
  "an id assigned by create does not change across subsequent load/save calls (SP-006)",
  "a project created via create appears in a subsequent listProjects call (SP-007)",
  "load round-trips exactly what save wrote for the same id (SP-010)",
  "save writes data.container as exactly the writeContainer byte output (SP-008)",
  "save writes data.sidecar alongside data.container in the same call (SP-009)",
  "save overwrites a previously saved project at the same id",
  "load rejects with a StorageError of kind \"not-found\" for an id that was never created (SP-018)",
  "save rejects with a StorageError of kind \"quota-exceeded\" when the backend refuses the write on quota grounds (SP-017)",
  "autosaveJournal is patch-shaped: accepts sinceRev + JsonPatchOp[] (SP-004)",
  "autosaveJournal appends to the journal without removing or reordering prior entries (SP-014)",
  "loadJournal returns patches appended by autosaveJournal since the given rev (journal replay, SP-004)",
  "replaying load(id) + loadJournal(id).patches in order reproduces the current document state (SP-015)",
  "a successful save clears the project's journal (SP-016)",
  "loadJournal after a crash-simulated restart replays to the same state autosaveJournal produced (crash recovery ≡ sync protocol)",
  "capabilities reports exactly { fileHandles, remote } consistent with what the implementation actually supports (SP-013)"
];

export function describeStorageProviderContract(makeProvider: () => StorageProvider): void {
  describe("StorageProvider contract", () => {
    for (const obligation of storageProviderContractObligations) {
      it.todo(obligation);
    }
  });
  // OPEN(SP-contract-usage-tbd): see the equivalent note on
  // describeRenderHostContract — makeProvider is unused until obligations
  // gain real assertions.
  void makeProvider;
}
