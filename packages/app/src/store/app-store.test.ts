// Focused unit tests for the play-mode wiring added to the store (see
// specs/document-model.md DOC-031/DOC-037/DOC-045, specs/ux-shell.md
// UX-106/UX-113): dispatchCommand's frozen-document pre-check, and
// startPlay/stopPlay's playState transitions. No `app-store.test.ts`
// precedent existed before this — a full harness against the real
// `IndexedDBStorage`/`HistoryStack` machinery is out of scope here, so this
// only exercises the store's own play-mode logic with a minimal fake
// `Container`/`RenderHost` and a mocked `@gltf-studio/play` (the real
// `PlayControllerImpl` is covered by `packages/play`'s own tests).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "@gltfi/gltf";
import { createDocument, HistoryStack, type Command } from "@gltf-studio/editor-core";
import type { CameraPose, PatchOutcome, RenderHost } from "@gltf-studio/engine-api";

const controllerMocks = {
  start: vi.fn(async () => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  tickOnce: vi.fn(),
  stop: vi.fn(async () => {}),
  inspect: vi.fn(() => ({ time: 0, variables: {}, sentEvents: [] })),
  onDiagnostic: vi.fn(() => () => {}),
  fireSelect: vi.fn(),
  fireHoverIn: vi.fn(),
  fireHoverOut: vi.fn()
};

vi.mock("@gltf-studio/play", () => ({
  createPlayController: vi.fn(() => controllerMocks)
}));

// The real `IndexedDBStorage` throws at construction time without a real or
// injected `IDBFactory` (see packages/storage's own indexeddb-storage.ts) —
// `fake-indexeddb` is only a devDependency of packages/storage, not
// packages/app, so rather than pull in that whole dependency for a store
// test that never exercises persistence, stub the one method dispatchCommand
// actually calls (`autosaveJournal`, fire-and-forget).
vi.mock("@gltf-studio/storage", () => ({
  IndexedDBStorage: class {
    capabilities = { fileHandles: false, remote: false };
    autosaveJournal = vi.fn(async () => {});
  }
}));

const { useAppStore } = await import("./app-store.js");

function fakeContainer(json: unknown): Container {
  return {
    kind: "glb",
    chunks: [],
    jsonChunkIndex: 0,
    jsonText: JSON.stringify(json),
    json,
    binaryChunk: undefined
  };
}

function fakeRenderHost(): RenderHost {
  return {
    mount: vi.fn(),
    loadScene: vi.fn(async () => {}),
    dispose: vi.fn(),
    patchScene: vi.fn((): PatchOutcome => "applied"),
    pick: vi.fn(() => null),
    getCameraPose: vi.fn((): CameraPose => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] })),
    setCameraPose: vi.fn(),
    attachGizmo: vi.fn(),
    detachGizmo: vi.fn(),
    onGizmoChange: vi.fn(() => () => {}),
    applyPointer: vi.fn(),
    setHighlight: vi.fn(),
    snapshot: vi.fn(async () => new Blob())
  };
}

function dummyCommand(): Command {
  return { id: "cmd-1", label: "test", patches: [{ op: "replace", path: "/nodes/0/name", value: "x" }], inverse: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  controllerMocks.start.mockResolvedValue(undefined);
  controllerMocks.stop.mockResolvedValue(undefined);

  const document = createDocument(fakeContainer({ asset: { version: "2.0" }, nodes: [{ name: "A" }] }));
  const history = new HistoryStack(document);
  useAppStore.setState({
    projectId: "proj-1",
    document,
    history,
    renderHost: fakeRenderHost(),
    playState: "stopped",
    playEngine: "interpreter",
    toasts: [],
    consoleLines: []
  });
});

describe("dispatchCommand frozen-document pre-check (DOC-031/DOC-037)", () => {
  it("applies a command normally while stopped", () => {
    const before = useAppStore.getState().history!.document;
    useAppStore.getState().dispatchCommand(dummyCommand());
    expect(useAppStore.getState().history!.document).not.toBe(before);
    expect(useAppStore.getState().document).toBe(useAppStore.getState().history!.document);
  });

  it("rejects a command while playing, before it ever reaches HistoryStack.push, and toasts", () => {
    useAppStore.setState({ playState: "playing" });
    const before = useAppStore.getState().history!.document;
    useAppStore.getState().dispatchCommand(dummyCommand());
    expect(useAppStore.getState().history!.document).toBe(before); // untouched
    expect(useAppStore.getState().toasts.at(-1)?.text).toBe("Document locked while playing — Stop to edit.");
  });

  it("rejects a command while paused", () => {
    useAppStore.setState({ playState: "paused" });
    const before = useAppStore.getState().history!.document;
    useAppStore.getState().dispatchCommand(dummyCommand());
    expect(useAppStore.getState().history!.document).toBe(before);
  });

  it("also guards undo/redo while playing", () => {
    // Push one command while stopped so there is something to (attempt to) undo.
    useAppStore.getState().dispatchCommand(dummyCommand());
    const beforePlaying = useAppStore.getState().history!.document;
    useAppStore.setState({ playState: "playing" });
    useAppStore.getState().undo();
    expect(useAppStore.getState().history!.document).toBe(beforePlaying);
  });
});

describe("startPlay / stopPlay state transitions (UX-310)", () => {
  it("startPlay freezes the document, sets playState to playing, and clears selection", async () => {
    useAppStore.setState({ selectedNodeIndex: 0, hoveredNodeIndex: 0 });
    await useAppStore.getState().startPlay();
    expect(controllerMocks.start).toHaveBeenCalledWith({ engine: "interpreter" });
    expect(useAppStore.getState().playState).toBe("playing");
    expect(useAppStore.getState().document!.frozen).toBe(true);
    expect(useAppStore.getState().selectedNodeIndex).toBeNull();
    expect(useAppStore.getState().hoveredNodeIndex).toBeNull();
  });

  it("is a no-op when already playing/paused", async () => {
    await useAppStore.getState().startPlay();
    const { createPlayController } = await import("@gltf-studio/play");
    expect(createPlayController).toHaveBeenCalledTimes(1);
    await useAppStore.getState().startPlay();
    expect(createPlayController).toHaveBeenCalledTimes(1); // not called again
  });

  it("stopPlay unfreezes the document and returns playState to stopped", async () => {
    await useAppStore.getState().startPlay();
    await useAppStore.getState().stopPlay();
    expect(controllerMocks.stop).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playState).toBe("stopped");
    expect(useAppStore.getState().document!.frozen).toBe(false);
  });

  it("pausePlay/resumePlay delegate to the controller and flip playState", async () => {
    await useAppStore.getState().startPlay();
    useAppStore.getState().pausePlay();
    expect(controllerMocks.pause).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playState).toBe("paused");

    useAppStore.getState().resumePlay();
    expect(controllerMocks.resume).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playState).toBe("playing");
  });

  it("dispatchCommand rejects again once play has actually started (not just a manually-set flag)", async () => {
    await useAppStore.getState().startPlay();
    const before = useAppStore.getState().history!.document;
    useAppStore.getState().dispatchCommand(dummyCommand());
    expect(useAppStore.getState().history!.document).toBe(before);
  });
});
