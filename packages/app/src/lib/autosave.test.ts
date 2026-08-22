// specs/ux-shell.md UX-123/UX-124: the debounce scheduler and best-effort
// thumbnail capture, in isolation from the store.
import { describe, expect, it, vi } from "vitest";
import type { RenderHost } from "@gltf-studio/engine-api";
import { AUTOSAVE_DEBOUNCE_MS, createAutosaveScheduler, tryCaptureThumbnail } from "./autosave.js";

describe("createAutosaveScheduler (UX-123)", () => {
  it("runs once after the debounce window elapses", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createAutosaveScheduler(run, 1000);
    scheduler.schedule();
    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("collapses rapid successive schedule() calls into a single run (debounce, not throttle)", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createAutosaveScheduler(run, 1000);
    scheduler.schedule();
    vi.advanceTimersByTime(600);
    scheduler.schedule(); // resets the window -- an edit within the debounce delays the run further
    vi.advanceTimersByTime(600);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancel() prevents a pending run", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createAutosaveScheduler(run, 1000);
    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("defaults to AUTOSAVE_DEBOUNCE_MS when no delay is given", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createAutosaveScheduler(run);
    scheduler.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

function fakeRenderHost(overrides: Partial<RenderHost> = {}): RenderHost {
  return {
    mount: vi.fn(),
    loadScene: vi.fn(async () => {}),
    dispose: vi.fn(),
    patchScene: vi.fn(() => "applied"),
    pick: vi.fn(() => null),
    getCameraPose: vi.fn(() => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] })),
    setCameraPose: vi.fn(),
    attachGizmo: vi.fn(),
    detachGizmo: vi.fn(),
    onGizmoChange: vi.fn(() => () => {}),
    applyPointer: vi.fn(),
    setHighlight: vi.fn(),
    setReferenceHighlight: vi.fn(),
    setEditorHelpers: vi.fn(),
    snapshot: vi.fn(async () => new Blob(["x"])),
    ...overrides
  } as RenderHost;
}

describe("tryCaptureThumbnail (UX-124)", () => {
  it("resolves undefined when no RenderHost is registered", async () => {
    expect(await tryCaptureThumbnail(undefined)).toBeUndefined();
    expect(await tryCaptureThumbnail(null)).toBeUndefined();
  });

  it("resolves the RenderHost's snapshot when it succeeds", async () => {
    const host = fakeRenderHost();
    const blob = await tryCaptureThumbnail(host);
    expect(blob).toBeInstanceOf(Blob);
    expect(host.snapshot).toHaveBeenCalledTimes(1);
  });

  it("resolves undefined (never throws) when RenderHost.snapshot() rejects", async () => {
    const host = fakeRenderHost({ snapshot: vi.fn(async () => Promise.reject(new Error("no canvas"))) });
    await expect(tryCaptureThumbnail(host)).resolves.toBeUndefined();
  });
});
