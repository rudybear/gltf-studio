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
    setReferenceHighlight: vi.fn(),
    snapshot: vi.fn(async () => new Blob())
  };
}

function dummyCommand(): Command {
  return { id: "cmd-1", label: "test", patches: [{ op: "replace", path: "/nodes/0/name", value: "x" }], inverse: [] };
}

/** Unlike `dummyCommand` above (a real `inverse: []` no-op, fine for the play-mode-guard tests that never call `undo`/`redo`), this has a REAL inverse -- needed by the task #36 journal tests below, which assert on `undo()`'s returned/journaled patches actually reverting something. */
function reversibleCommand(): Command {
  return {
    id: "cmd-reversible",
    label: "test reversible",
    patches: [{ op: "replace", path: "/nodes/0/name", value: "x" }],
    inverse: [{ op: "replace", path: "/nodes/0/name", value: "A" }]
  };
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
    expect(controllerMocks.start).toHaveBeenCalledWith({ engine: "interpreter", debug: false });
    expect(useAppStore.getState().playState).toBe("playing");
    expect(useAppStore.getState().document!.frozen).toBe(true);
    expect(useAppStore.getState().selectedNodeIndex).toBeNull();
    expect(useAppStore.getState().hoveredNodeIndex).toBeNull();
  });

  it("startPlay passes debug:true when the compiled engine is selected and the toggle is checked (PC-009, UX-130)", async () => {
    useAppStore.setState({ playEngine: "compiled", playDebug: true });
    await useAppStore.getState().startPlay();
    expect(controllerMocks.start).toHaveBeenCalledWith({ engine: "compiled", debug: true });
  });

  it("startPlay forces debug:false under the interpreter engine even with a stale playDebug:true left over from a prior compiled session (PC-009's own no-op guarantee, defense in depth alongside the toggle's disabled UI state)", async () => {
    useAppStore.setState({ playEngine: "interpreter", playDebug: true });
    await useAppStore.getState().startPlay();
    expect(controllerMocks.start).toHaveBeenCalledWith({ engine: "interpreter", debug: false });
  });

  it("setPlayDebug updates playDebug only while stopped (UX-130, mirrors setPlayEngine)", () => {
    useAppStore.getState().setPlayDebug(true);
    expect(useAppStore.getState().playDebug).toBe(true);

    useAppStore.setState({ playState: "playing" });
    useAppStore.getState().setPlayDebug(false);
    expect(useAppStore.getState().playDebug).toBe(true); // unchanged — no-op while not stopped
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

// Task #36 (closes the SP-004 journal gap this store's own undo()/redo()
// previously documented but didn't fix): before this, only dispatchCommand
// appended to the autosave journal -- undo/redo changed `history.document`
// but were invisible to `loadJournal` replay (SP-015), so a crash strictly
// between an undo/redo and the next debounced full checkpoint (UX-123, up
// to 1.5s later) recovered to the PRE-undo/redo state. `HistoryStack.undo()`/
// `redo()` (packages/editor-core/src/history.ts) now RETURN the exact
// forward-direction patches they just applied (DOC-013/DOC-040 — the same
// value `onApply`'s handlers already saw) instead of `void`; the store
// actions below append that return value to the journal the same way
// dispatchCommand appends a pushed command's own `patches` -- see
// project-lifecycle.test.ts / e2e/crash-recovery.spec.ts for the
// checkoutProject/replay side of this same fix.
describe("undo()/redo() journal-consistency (UX-128, DOC-061, task #36)", () => {
  it("undo() appends its inverse patches to the autosave journal, scoped to the current journalSinceRev", () => {
    useAppStore.setState({ journalSinceRev: 3 });
    const storage = useAppStore.getState().storage as unknown as { autosaveJournal: ReturnType<typeof vi.fn> };
    const command = reversibleCommand();
    useAppStore.getState().dispatchCommand(command);
    storage.autosaveJournal.mockClear(); // isolate undo()'s own call from dispatchCommand's

    useAppStore.getState().undo();

    expect(storage.autosaveJournal).toHaveBeenCalledTimes(1);
    expect(storage.autosaveJournal).toHaveBeenCalledWith("proj-1", 3, command.inverse);
  });

  it("redo() appends its (forward) patches to the autosave journal", () => {
    useAppStore.setState({ journalSinceRev: 3 });
    const storage = useAppStore.getState().storage as unknown as { autosaveJournal: ReturnType<typeof vi.fn> };
    const command = reversibleCommand();
    useAppStore.getState().dispatchCommand(command);
    useAppStore.getState().undo();
    storage.autosaveJournal.mockClear();

    useAppStore.getState().redo();

    expect(storage.autosaveJournal).toHaveBeenCalledTimes(1);
    expect(storage.autosaveJournal).toHaveBeenCalledWith("proj-1", 3, command.patches);
  });

  it("undo()/redo() are no-ops (no journal call) when there's nothing to undo/redo", () => {
    const storage = useAppStore.getState().storage as unknown as { autosaveJournal: ReturnType<typeof vi.fn> };
    storage.autosaveJournal.mockClear();

    useAppStore.getState().undo(); // canUndo() is false -- nothing was pushed this test
    useAppStore.getState().redo();

    expect(storage.autosaveJournal).not.toHaveBeenCalled();
  });

  it("a crash strictly between an undo and the next debounced checkpoint recovers to the POST-undo state (journal replay is gap-free)", async () => {
    // Simulates checkoutProject's own replay (project-lifecycle.ts): load
    // the last-SAVED json, then apply whatever the journal accumulated
    // since. Here the "last save" is the document's state BEFORE the
    // command ever pushed (rev 0), and the journal is exactly what
    // dispatchCommand's push + this fix's undo() call appended -- i.e.
    // the net effect of "push, then undo" should replay back to a no-op
    // (the pre-push state), never landing on the PUSHED (pre-undo) state.
    const baseJson = useAppStore.getState().history!.document.json;
    const storage = useAppStore.getState().storage as unknown as { autosaveJournal: ReturnType<typeof vi.fn> };
    const journal: Array<{ op: string; path: string; value?: unknown }> = [];
    storage.autosaveJournal.mockImplementation(async (_id: string, _sinceRev: number, patches: typeof journal) => {
      journal.push(...patches);
    });

    const command = reversibleCommand();
    useAppStore.getState().dispatchCommand(command); // "unsaved" edit, journaled
    useAppStore.getState().undo(); // "crash" happens right after this, before the 1.5s checkpoint

    const { applyPatches } = await import("@gltf-studio/editor-core");
    const recovered = applyPatches(baseJson, journal as never);
    expect(recovered).toEqual(baseJson); // POST-undo state: back to where it started, not the pushed edit
    expect(recovered).toEqual(useAppStore.getState().history!.document.json); // matches live state too
  });
});
