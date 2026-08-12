// Unit coverage for the persistence & sharing store slice added on top of
// the existing importGlb/dispatchCommand machinery: the project manager
// (specs/ux-shell.md UX-122: open/rename/duplicate/delete/new) and crash
// recovery (UX-125: loadJournal-ahead-of-save -> recoveryOffer ->
// applyRecovery/discardRecovery). Uses the REAL `IndexedDBStorage` backed by
// `fake-indexeddb` (not a hand-rolled fake) so these tests exercise the
// genuine SP-0xx contract this slice is built on, same rationale as
// `packages/storage`'s own contract-test suite -- only `IndexedDBStorage`'s
// name binding is swapped (to a no-op stub) at MODULE-LOAD time, since
// app-store.ts's own default `storage: new IndexedDBStorage()` field
// initializer would otherwise throw immediately under Node (no global
// `indexedDB`); every test below replaces `storage` with a real,
// fake-indexeddb-backed instance before doing anything else, via
// `vi.importActual` to reach the unmocked class.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { writeContainer, type Container } from "@gltfi/gltf";
import type { StorageProvider } from "@gltf-studio/engine-api";

vi.mock("@gltf-studio/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gltf-studio/storage")>();
  return {
    ...actual,
    IndexedDBStorage: class {
      capabilities = { fileHandles: false, remote: false };
    }
  };
});

const { useAppStore } = await import("./app-store.js");
const { IndexedDBStorage: RealIndexedDBStorage } = await vi.importActual<typeof import("@gltf-studio/storage")>("@gltf-studio/storage");

function freshDbName(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const CHUNK_TYPE_JSON = 0x4e4f534a;

function glbBytes(json: Record<string, unknown>): Uint8Array {
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return writeContainer(container) as Uint8Array;
}

function baseSceneJson(counter: number): Record<string, unknown> {
  return { asset: { version: "2.0" }, scene: 0, scenes: [{ name: "Scene" }], extras: { counter } };
}

beforeEach(() => {
  const storage = new RealIndexedDBStorage({ indexedDB: fakeIndexedDB, dbName: freshDbName() }) as unknown as StorageProvider;
  useAppStore.setState({
    storage,
    projectId: null,
    projectMeta: null,
    projectName: "Untitled Project",
    projectDirty: false,
    saveStatus: "saved",
    history: null,
    document: null,
    recoveryOffer: null,
    projects: [],
    projectManagerOpen: false,
    renderHost: null,
    toasts: [],
    consoleLines: []
  });
});

describe("openProjectById (UX-125)", () => {
  it("installs a project's last-saved state and marks it saved when the journal is empty", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "My Project", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(1)), sidecar: null });

    await useAppStore.getState().openProjectById(meta.id);

    const state = useAppStore.getState();
    expect(state.projectId).toBe(meta.id);
    expect(state.projectName).toBe("My Project");
    expect(state.saveStatus).toBe("saved");
    expect(state.projectDirty).toBe(false);
    expect(state.recoveryOffer).toBeNull();
    expect((state.document!.json as { extras: { counter: number } }).extras.counter).toBe(1);
  });

  it("surfaces a recoveryOffer (without auto-applying it) when the journal is ahead of the last save", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "Crashed Project", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(1)), sidecar: null });
    // Simulate a crash: a command's patches made it into the journal (SP-004)
    // but no full save consolidated them (SP-016 never ran).
    await storage.autosaveJournal(meta.id, 0, [{ op: "replace", path: "/extras/counter", value: 99 }]);

    await useAppStore.getState().openProjectById(meta.id);

    const state = useAppStore.getState();
    // Opens at the last-SAVED state first -- never stuck/blank while the user decides.
    expect((state.document!.json as { extras: { counter: number } }).extras.counter).toBe(1);
    expect(state.saveStatus).toBe("saved");
    expect(state.recoveryOffer).not.toBeNull();
    expect(state.recoveryOffer!.projectId).toBe(meta.id);
    expect(state.recoveryOffer!.patches).toEqual([{ op: "replace", path: "/extras/counter", value: 99 }]);
  });

  it("clears a stale last-open bookmark and does not toast when the project no longer exists (SP-018 not-found)", async () => {
    await useAppStore.getState().openProjectById("never-created-id");
    const state = useAppStore.getState();
    expect(state.projectId).toBeNull();
    expect(state.toasts).toEqual([]);
  });
});

describe("applyRecovery / discardRecovery (UX-125)", () => {
  async function setUpCrashedProject(): Promise<string> {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "Crashed", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(1)), sidecar: null });
    await storage.autosaveJournal(meta.id, 0, [{ op: "replace", path: "/extras/counter", value: 99 }]);
    await useAppStore.getState().openProjectById(meta.id);
    return meta.id;
  }

  it("applyRecovery replays the pending patches and marks the result dirty", async () => {
    await setUpCrashedProject();
    useAppStore.getState().applyRecovery();

    const state = useAppStore.getState();
    expect((state.document!.json as { extras: { counter: number } }).extras.counter).toBe(99);
    expect(state.saveStatus).toBe("unsaved");
    expect(state.projectDirty).toBe(true);
    expect(state.recoveryOffer).toBeNull();
  });

  it("discardRecovery keeps the last-saved state and clears the stale journal (SP-016)", async () => {
    const id = await setUpCrashedProject();
    const { storage } = useAppStore.getState();

    await useAppStore.getState().discardRecovery();

    expect(useAppStore.getState().recoveryOffer).toBeNull();
    expect((useAppStore.getState().document!.json as { extras: { counter: number } }).extras.counter).toBe(1);
    const journal = await storage.loadJournal(id);
    expect(journal.patches).toEqual([]);
  });
});

describe("project manager row actions (UX-122)", () => {
  it("renameProject updates the stored meta and, for the open project, projectName too", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "Old Name", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(0)), sidecar: null });
    await useAppStore.getState().openProjectById(meta.id);

    await useAppStore.getState().renameProject(meta.id, "New Name");

    expect(useAppStore.getState().projectName).toBe("New Name");
    const reloaded = await storage.load(meta.id);
    expect(reloaded.meta.name).toBe("New Name");
  });

  it("duplicateProject creates a second project with the same container, leaving the original untouched", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "Original", createdAt: now, updatedAt: now });
    const bytes = glbBytes(baseSceneJson(7));
    await storage.save(meta.id, { meta, container: bytes, sidecar: { note: "sidecar" } });

    await useAppStore.getState().duplicateProject(meta.id);

    const all = await storage.listProjects();
    expect(all).toHaveLength(2);
    const copy = all.find((p) => p.id !== meta.id)!;
    expect(copy.name).toBe("Original copy");
    const copyData = await storage.load(copy.id);
    expect(Array.from(copyData.container)).toEqual(Array.from(bytes));
    expect(copyData.sidecar).toEqual({ note: "sidecar" });
    // Original untouched.
    const original = await storage.load(meta.id);
    expect(original.meta.name).toBe("Original");
  });

  it("deleteProject removes the project and, when it was open, resets to the pre-project state", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "To Delete", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(0)), sidecar: null });
    await useAppStore.getState().openProjectById(meta.id);

    await useAppStore.getState().deleteProject(meta.id);

    expect(useAppStore.getState().projectId).toBeNull();
    expect(useAppStore.getState().document).toBeNull();
    await expect(storage.load(meta.id)).rejects.toMatchObject({ kind: "not-found" });
  });

  it("deleteProject on a project that is NOT open leaves the current project untouched", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const openMeta = await storage.create({ name: "Open One", createdAt: now, updatedAt: now });
    await storage.save(openMeta.id, { meta: openMeta, container: glbBytes(baseSceneJson(0)), sidecar: null });
    await useAppStore.getState().openProjectById(openMeta.id);

    const otherMeta = await storage.create({ name: "Other", createdAt: now, updatedAt: now });
    await storage.save(otherMeta.id, { meta: otherMeta, container: glbBytes(baseSceneJson(0)), sidecar: null });

    await useAppStore.getState().deleteProject(otherMeta.id);

    expect(useAppStore.getState().projectId).toBe(openMeta.id);
  });

  it("refreshProjects populates `projects` in SP-022's updatedAt-descending order", async () => {
    const { storage } = useAppStore.getState();
    const older = await storage.create({ name: "Older", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" });
    await storage.save(older.id, { meta: older, container: glbBytes(baseSceneJson(0)), sidecar: null });
    const newer = await storage.create({ name: "Newer", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" });
    await storage.save(newer.id, { meta: newer, container: glbBytes(baseSceneJson(0)), sidecar: null });

    await useAppStore.getState().refreshProjects();

    expect(useAppStore.getState().projects.map((p) => p.id)).toEqual([newer.id, older.id]);
  });

  it("newProjectFromManager opens a fresh empty scene and closes the dialog", async () => {
    useAppStore.setState({ projectManagerOpen: true });
    await useAppStore.getState().newProjectFromManager();

    const state = useAppStore.getState();
    expect(state.projectManagerOpen).toBe(false);
    expect(state.projectId).not.toBeNull();
    expect((state.document!.json as { nodes?: unknown[] }).nodes ?? []).toEqual([]);
  });

  it("openProjectFromManager opens the project and closes the dialog", async () => {
    const { storage } = useAppStore.getState();
    const now = new Date().toISOString();
    const meta = await storage.create({ name: "Via Manager", createdAt: now, updatedAt: now });
    await storage.save(meta.id, { meta, container: glbBytes(baseSceneJson(0)), sidecar: null });
    useAppStore.setState({ projectManagerOpen: true });

    await useAppStore.getState().openProjectFromManager(meta.id);

    const state = useAppStore.getState();
    expect(state.projectManagerOpen).toBe(false);
    expect(state.projectId).toBe(meta.id);
  });
});
