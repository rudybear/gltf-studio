// specs/ux-shell.md UX-125: the last-open-project localStorage bookmark and
// the journal-ahead-of-save checkout helper crash recovery is built on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonPatchOp, ProjectData, ProjectMeta, StorageProvider } from "@gltf-studio/engine-api";
import { checkoutProject, LAST_PROJECT_STORAGE_KEY, readLastProjectId, rememberLastProjectId } from "./project-lifecycle.js";

function fakeMeta(id: string): ProjectMeta {
  return { id, name: "Test", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };
}

function fakeStorage(data: ProjectData, journal: { sinceRev: number; patches: JsonPatchOp[] }): StorageProvider {
  return {
    capabilities: { fileHandles: false, remote: false },
    listProjects: vi.fn(async () => [data.meta]),
    create: vi.fn(async () => data.meta),
    load: vi.fn(async () => data),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    autosaveJournal: vi.fn(async () => {}),
    loadJournal: vi.fn(async () => journal)
  };
}

// Plain `vitest.config.ts` runs this package under Node (no jsdom, no real
// `localStorage`/`window`) -- a tiny in-memory `Storage` stand-in installed
// on `globalThis` is enough to exercise `project-lifecycle.ts`'s own
// `globalThis.localStorage` calls for real, the same way `fs-test-shim.ts`
// stands in for the File System Access API elsewhere in this program.
class FakeStorage {
  #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  clear(): void {
    this.#map.clear();
  }
}

describe("rememberLastProjectId / readLastProjectId (UX-125)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = new FakeStorage() as unknown as Storage;
  });

  it("round-trips an id through localStorage", () => {
    expect(readLastProjectId()).toBeNull();
    rememberLastProjectId("proj-1");
    expect(readLastProjectId()).toBe("proj-1");
    expect(globalThis.localStorage.getItem(LAST_PROJECT_STORAGE_KEY)).toBe("proj-1");
  });

  it("clears the bookmark when passed null", () => {
    rememberLastProjectId("proj-1");
    rememberLastProjectId(null);
    expect(readLastProjectId()).toBeNull();
  });
});

describe("checkoutProject (SP-015)", () => {
  it("reports an empty pendingPatches array when the journal has nothing beyond the last save", async () => {
    const data: ProjectData = { meta: fakeMeta("p1"), container: new Uint8Array([1, 2, 3]), sidecar: null };
    const storage = fakeStorage(data, { sinceRev: 3, patches: [] });
    const result = await checkoutProject(storage, "p1");
    expect(result.data).toBe(data);
    expect(result.pendingPatches).toEqual([]);
  });

  it("surfaces the journal's patches when it is ahead of the last save (the crash-recovery condition)", async () => {
    const data: ProjectData = { meta: fakeMeta("p1"), container: new Uint8Array([1]), sidecar: { value: 0 } };
    const patches: JsonPatchOp[] = [{ op: "replace", path: "/value", value: 99 }];
    const storage = fakeStorage(data, { sinceRev: 0, patches });
    const result = await checkoutProject(storage, "p1");
    expect(result.pendingPatches).toEqual(patches);
  });
});
