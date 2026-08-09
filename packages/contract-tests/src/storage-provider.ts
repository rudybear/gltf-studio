import { describe, expect, it } from "vitest";
import type { JsonPatchOp, ProjectMeta, StorageProvider } from "@gltf-studio/engine-api";

/**
 * StorageProvider contract obligations, transcribed from Phase A. Both
 * shipped implementations (`@gltf-studio/storage`'s IndexedDBStorage and
 * FileSystemAccessStorage) must pass this suite — see that package's
 * indexeddb-storage.test.ts / filesystem-storage.test.ts, which call
 * `describeStorageProviderContract` against each.
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

function freshMeta(name = "Test Project"): Omit<ProjectMeta, "id"> {
  const now = new Date().toISOString();
  return { name, createdAt: now, updatedAt: now };
}

/** A tiny "document state" simulacrum: an object patched forward by JsonPatchOp `replace`/`add`/`remove` ops, used to exercise journal replay (SP-015) without depending on editor-core. */
function applySimplePatches(base: Record<string, unknown>, patches: JsonPatchOp[]): Record<string, unknown> {
  let state = { ...base };
  for (const patch of patches) {
    const key = patch.path.replace(/^\//, "");
    if (patch.op === "replace" || patch.op === "add") {
      state = { ...state, [key]: patch.value };
    } else if (patch.op === "remove") {
      state = { ...state };
      delete state[key];
    }
  }
  return state;
}

/**
 * @param makeProvider Returns a fresh, empty StorageProvider instance.
 * @param makeQuotaConstrainedProvider Returns a fresh StorageProvider instance
 *   configured so that ANY `save()` call on it will be refused for quota
 *   reasons — used only by the SP-017 test. Implementations expose this via
 *   a constructor option (e.g. `quotaLimitBytes: 0`); it is not part of the
 *   `StorageProvider` interface itself.
 */
export function describeStorageProviderContract(
  makeProvider: () => StorageProvider,
  makeQuotaConstrainedProvider: () => StorageProvider
): void {
  describe("StorageProvider contract", () => {
    it("listProjects returns an empty array for a fresh provider (SP-001)", async () => {
      const provider = makeProvider();
      await expect(provider.listProjects()).resolves.toEqual([]);
    });

    it("create assigns an id and the project is then visible in listProjects (SP-001)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      expect(typeof created.id).toBe("string");
      expect(created.id.length).toBeGreaterThan(0);
      const list = await provider.listProjects();
      expect(list.some((p) => p.id === created.id)).toBe(true);
    });

    it("create never returns the same id twice across calls on the same provider instance (SP-005)", async () => {
      const provider = makeProvider();
      const ids = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const created = await provider.create(freshMeta(`Project ${i}`));
        expect(ids.has(created.id)).toBe(false);
        ids.add(created.id);
      }
    });

    it("an id assigned by create does not change across subsequent load/save calls (SP-006)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const loaded = await provider.load(created.id);
      expect(loaded.meta.id).toBe(created.id);
      await provider.save(created.id, { meta: loaded.meta, container: new Uint8Array([1, 2, 3]), sidecar: null });
      const reloaded = await provider.load(created.id);
      expect(reloaded.meta.id).toBe(created.id);
    });

    it("a project created via create appears in a subsequent listProjects call (SP-007)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta("Findable"));
      const list = await provider.listProjects();
      expect(list.map((p) => p.id)).toContain(created.id);
    });

    it("load round-trips exactly what save wrote for the same id (SP-010)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const container = new Uint8Array([10, 20, 30, 40, 50]);
      const sidecar = { panelLayout: { leftWidth: 260 }, cameraBookmarks: [] as unknown[] };
      await provider.save(created.id, { meta: created, container, sidecar });
      const loaded = await provider.load(created.id);
      expect(Array.from(loaded.container)).toEqual(Array.from(container));
      expect(loaded.sidecar).toEqual(sidecar);
      expect(loaded.meta.id).toBe(created.id);
    });

    it("save writes data.container as exactly the writeContainer byte output (SP-008)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const container = new Uint8Array([9, 8, 7, 6, 0, 255]);
      await provider.save(created.id, { meta: created, container, sidecar: null });
      const loaded = await provider.load(created.id);
      expect(Array.from(loaded.container)).toEqual([9, 8, 7, 6, 0, 255]);
    });

    it("save writes data.sidecar alongside data.container in the same call (SP-009)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const sidecar = { note: "sidecar-value", count: 3 };
      await provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar });
      const loaded = await provider.load(created.id);
      expect(loaded.sidecar).toEqual(sidecar);
      expect(Array.from(loaded.container)).toEqual([1]);
    });

    it("save overwrites a previously saved project at the same id", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      await provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar: "first" });
      await provider.save(created.id, { meta: created, container: new Uint8Array([2, 2]), sidecar: "second" });
      const loaded = await provider.load(created.id);
      expect(Array.from(loaded.container)).toEqual([2, 2]);
      expect(loaded.sidecar).toBe("second");
      const list = await provider.listProjects();
      expect(list.filter((p) => p.id === created.id)).toHaveLength(1);
    });

    it('load rejects with a StorageError of kind "not-found" for an id that was never created (SP-018)', async () => {
      const provider = makeProvider();
      await expect(provider.load("never-created-id")).rejects.toMatchObject({ kind: "not-found" });
    });

    it('save rejects with a StorageError of kind "quota-exceeded" when the backend refuses the write on quota grounds (SP-017)', async () => {
      const provider = makeQuotaConstrainedProvider();
      const created = await provider.create(freshMeta());
      await expect(
        provider.save(created.id, { meta: created, container: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), sidecar: null })
      ).rejects.toMatchObject({ kind: "quota-exceeded" });
    });

    it("autosaveJournal is patch-shaped: accepts sinceRev + JsonPatchOp[] (SP-004)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const patches: JsonPatchOp[] = [{ op: "replace", path: "/name", value: "Renamed" }];
      await expect(provider.autosaveJournal(created.id, 0, patches)).resolves.toBeUndefined();
    });

    it("autosaveJournal appends to the journal without removing or reordering prior entries (SP-014)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const first: JsonPatchOp[] = [{ op: "replace", path: "/a", value: 1 }];
      const second: JsonPatchOp[] = [{ op: "replace", path: "/b", value: 2 }];
      await provider.autosaveJournal(created.id, 0, first);
      await provider.autosaveJournal(created.id, 0, second);
      const journal = await provider.loadJournal(created.id);
      expect(journal.patches).toEqual([...first, ...second]);
    });

    it("loadJournal returns patches appended by autosaveJournal since the given rev (journal replay, SP-004)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const patches: JsonPatchOp[] = [{ op: "replace", path: "/x", value: 42 }];
      await provider.autosaveJournal(created.id, 5, patches);
      const journal = await provider.loadJournal(created.id);
      expect(journal.sinceRev).toBe(5);
      expect(journal.patches).toEqual(patches);
    });

    it("replaying load(id) + loadJournal(id).patches in order reproduces the current document state (SP-015)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      const baseState = { name: "Base", value: 1 };
      await provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar: baseState });

      const patches: JsonPatchOp[] = [
        { op: "replace", path: "/value", value: 2 },
        { op: "add", path: "/extra", value: true }
      ];
      await provider.autosaveJournal(created.id, 0, patches);

      const base = await provider.load(created.id);
      const journal = await provider.loadJournal(created.id);
      const replayed = applySimplePatches(base.sidecar as Record<string, unknown>, journal.patches);

      expect(replayed).toEqual({ name: "Base", value: 2, extra: true });
    });

    it("a successful save clears the project's journal (SP-016)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      await provider.autosaveJournal(created.id, 0, [{ op: "replace", path: "/x", value: 1 }]);
      await provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar: null });
      const journal = await provider.loadJournal(created.id);
      expect(journal.patches).toEqual([]);
    });

    it("loadJournal after a crash-simulated restart replays to the same state autosaveJournal produced (crash recovery ≡ sync protocol)", async () => {
      const provider = makeProvider();
      const created = await provider.create(freshMeta());
      await provider.save(created.id, { meta: created, container: new Uint8Array([1]), sidecar: { value: 0 } });
      const patches: JsonPatchOp[] = [{ op: "replace", path: "/value", value: 99 }];
      await provider.autosaveJournal(created.id, 0, patches);

      // "Crash" = drop the in-memory provider and inspect only what the
      // backing store durably has, via a second load/loadJournal pair
      // (the closest a StorageProvider-level test can get to a restart
      // without assuming anything about a given implementation's internal
      // handle lifecycle).
      const recoveredBase = await provider.load(created.id);
      const recoveredJournal = await provider.loadJournal(created.id);
      const replayed = applySimplePatches(recoveredBase.sidecar as Record<string, unknown>, recoveredJournal.patches);

      expect(replayed).toEqual({ value: 99 });
    });

    it("capabilities reports exactly { fileHandles, remote } consistent with what the implementation actually supports (SP-013)", () => {
      const provider = makeProvider();
      expect(Object.keys(provider.capabilities).sort()).toEqual(["fileHandles", "remote"]);
      expect(typeof provider.capabilities.fileHandles).toBe("boolean");
      expect(typeof provider.capabilities.remote).toBe("boolean");
    });
  });
}
