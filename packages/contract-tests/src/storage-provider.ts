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
  "load round-trips exactly what save wrote for the same id",
  "save overwrites a previously saved project at the same id",
  "load rejects (or reports absence) for an id that was never created",
  "autosaveJournal is patch-shaped: accepts sinceRev + JsonPatchOp[] (SP-004)",
  "loadJournal returns patches appended by autosaveJournal since the given rev (journal replay, SP-004)",
  "loadJournal after a crash-simulated restart replays to the same state autosaveJournal produced (crash recovery ≡ sync protocol)",
  "capabilities reports flags consistent with what the implementation actually supports"
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
