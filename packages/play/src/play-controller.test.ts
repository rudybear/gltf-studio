import { describe, expect, it } from "vitest";
import type { AudioHost, PlayDiagnostic, RenderHost } from "@gltf-studio/engine-api";
import type { FrameScheduler } from "./scheduler.js";
import { buildVariablesRecord, createPlayController, FIXED_TICK_DT, PlayControllerImpl } from "./play-controller.js";
import {
  noGraphGltfJson,
  onStartPointerSetGltfJson,
  onTickPointerSetGltfJson,
  throwingTickGltfJson,
  tickCounterGltfJson
} from "./test-fixtures.js";

function makeFakeRenderHost(overrides: Partial<RenderHost> = {}): RenderHost {
  const base: RenderHost = {
    mount: () => {},
    loadScene: async () => {},
    dispose: () => {},
    patchScene: () => "applied",
    pick: () => null,
    getCameraPose: () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }),
    setCameraPose: () => {},
    attachGizmo: () => {},
    detachGizmo: () => {},
    onGizmoChange: () => () => {},
    applyPointer: () => {},
    setHighlight: () => {},
    snapshot: async () => new Blob()
  };
  return { ...base, ...overrides };
}

function makeFakeAudioHost(overrides: Partial<AudioHost> = {}): AudioHost {
  const base: AudioHost = {
    init: async () => {},
    loadEmitters: async () => {},
    applyPointer: () => {},
    setListenerPose: () => {},
    auditionEmitter: () => {},
    suspend: () => {},
    resume: () => {},
    dispose: () => {}
  };
  return { ...base, ...overrides };
}

/**
 * A fully-manual `FrameScheduler`: `requestFrame` records the callback but
 * never invokes it on its own — the test drives ticks itself via `pause()` +
 * `tickOnce()` instead of via the scheduled loop. This is exactly the shape
 * a later contract-test suite is expected to inject too (see this package's
 * `FrameScheduler` doc comment).
 */
function makeManualScheduler(): FrameScheduler {
  let nextHandle = 1;
  return {
    now: () => 0,
    requestFrame: () => nextHandle++,
    cancelFrame: () => {}
  };
}

describe("FIXED_TICK_DT", () => {
  it("is exactly 1/60", () => {
    expect(FIXED_TICK_DT).toBe(1 / 60);
  });
});

describe("buildVariablesRecord (PC-002 id-vs-index fallback, pure)", () => {
  it("keys by declared id when present, and by the numeric index (as a string) otherwise", () => {
    const values = ["a-value", "b-value", "c-value"];
    const result = buildVariablesRecord(3, (i) => values[i], ["alpha", undefined, "gamma"]);
    expect(result).toEqual({ alpha: "a-value", "1": "b-value", gamma: "c-value" });
  });

  it("falls back to index for every slot when no ids array is supplied at all", () => {
    const result = buildVariablesRecord(2, (i) => i * 10, undefined);
    expect(result).toEqual({ "0": 0, "1": 10 });
  });
});

describe("PlayController fan-out order (PC-001/PC-005)", () => {
  it("calls renderHost.applyPointer before (lazily-read) audioHost.applyPointer", async () => {
    const order: string[] = [];
    const renderHost = makeFakeRenderHost({
      applyPointer: () => {
        order.push("render");
      }
    });
    const audioHost = makeFakeAudioHost({
      applyPointer: () => {
        order.push("audio");
      }
    });
    const controller = createPlayController({
      renderHost,
      getAudioHost: () => audioHost,
      getDocumentJson: () => onStartPointerSetGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    expect(order).toEqual(["render", "audio"]);
  });

  it("reads getAudioHost() lazily on every fan-out call, not once at start()", async () => {
    const registered: { current: AudioHost | undefined } = { current: undefined };
    const calls: string[] = [];
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getAudioHost: () => registered.current,
      getDocumentJson: () => onTickPointerSetGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    controller.pause();
    controller.tickOnce();
    expect(calls).toEqual([]); // no AudioHost registered yet at this first pointer write

    // Registered only AFTER start() already ran — mirrors "a concurrent
    // agent may call registerAudioHost() after play has already started".
    registered.current = makeFakeAudioHost({
      applyPointer: () => calls.push("audio")
    });
    controller.tickOnce();
    expect(calls).toEqual(["audio"]); // this SECOND pointer write picks up the newly-registered host
  });
});

describe("PlayController diagnostics (PC-005)", () => {
  it("reports a thrown renderHost.applyPointer as an unhandled-pointer diagnostic, and still calls audioHost", async () => {
    const audioCalls: string[] = [];
    const renderHost = makeFakeRenderHost({
      applyPointer: () => {
        throw new Error("boom-render");
      }
    });
    const audioHost = makeFakeAudioHost({
      applyPointer: () => audioCalls.push("audio")
    });
    const diagnostics: PlayDiagnostic[] = [];
    const controller = createPlayController({
      renderHost,
      getAudioHost: () => audioHost,
      getDocumentJson: () => onStartPointerSetGltfJson("/test/pointer", 7),
      scheduler: makeManualScheduler()
    });
    controller.onDiagnostic((d) => diagnostics.push(d));

    await controller.start({ engine: "interpreter" });

    expect(diagnostics).toEqual([{ kind: "unhandled-pointer", message: "boom-render", pointer: "/test/pointer" }]);
    // audioHost still gets a chance even though renderHost's call threw.
    expect(audioCalls).toEqual(["audio"]);
  });

  it("reports a thrown audioHost.applyPointer as its own unhandled-pointer diagnostic", async () => {
    const renderHost = makeFakeRenderHost();
    const audioHost = makeFakeAudioHost({
      applyPointer: () => {
        throw new Error("boom-audio");
      }
    });
    const diagnostics: PlayDiagnostic[] = [];
    const controller = createPlayController({
      renderHost,
      getAudioHost: () => audioHost,
      getDocumentJson: () => onStartPointerSetGltfJson(),
      scheduler: makeManualScheduler()
    });
    controller.onDiagnostic((d) => diagnostics.push(d));

    await controller.start({ engine: "interpreter" });

    expect(diagnostics).toEqual([{ kind: "unhandled-pointer", message: "boom-audio", pointer: "/test/pointer" }]);
  });

  it("onDiagnostic's returned unsubscribe function stops further delivery", async () => {
    const renderHost = makeFakeRenderHost({
      applyPointer: () => {
        throw new Error("boom");
      }
    });
    const diagnostics: PlayDiagnostic[] = [];
    const controller = createPlayController({
      renderHost,
      getDocumentJson: () => onStartPointerSetGltfJson(),
      scheduler: makeManualScheduler()
    });
    const unsubscribe = controller.onDiagnostic((d) => diagnostics.push(d));
    unsubscribe();

    await controller.start({ engine: "interpreter" });
    expect(diagnostics).toEqual([]);
  });

  it("reports an uncaught tick error as an engine-error diagnostic, via tickOnce while paused", async () => {
    const diagnostics: PlayDiagnostic[] = [];
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => throwingTickGltfJson(),
      scheduler: makeManualScheduler()
    });
    controller.onDiagnostic((d) => diagnostics.push(d));

    await controller.start({ engine: "interpreter" });
    controller.pause();
    controller.tickOnce();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe("engine-error");
    expect(diagnostics[0].message).toMatch(/declaration/);
  });
});

describe("PlayController start() rejection (PC-004)", () => {
  it("rejects clearly when the document has no KHR_interactivity graph, and leaves state \"stopped\"", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => noGraphGltfJson(),
      scheduler: makeManualScheduler()
    }) as PlayControllerImpl;

    await expect(controller.start({ engine: "interpreter" })).rejects.toThrow(/KHR_interactivity/);
    expect(controller.getPlayState()).toBe("stopped");
  });

  it("rejects start() while already playing/paused (PC-006)", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    await expect(controller.start({ engine: "interpreter" })).rejects.toThrow();
  });
});

describe("PlayController end-to-end against a real interpreter engine (PC-001/PC-002)", () => {
  it("tickOnce()/inspect() reflect real ticks of a tiny onTick-incrementing graph, keyed by the graph's declared variable id", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    controller.pause();

    expect(controller.inspect().variables.counter).toEqual({ type: "int", data: [0] });

    controller.tickOnce();
    controller.tickOnce();
    controller.tickOnce();

    const inspection = controller.inspect();
    expect(inspection.variables.counter).toEqual({ type: "int", data: [3] });
    expect(inspection.time).toBeGreaterThan(0);
    expect(inspection.sentEvents).toEqual([]);
  });

  it("inspect() returns the stopped-state shape before start() and after stop()", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    expect(controller.inspect()).toEqual({ time: 0, variables: {}, sentEvents: [] });

    await controller.start({ engine: "interpreter" });
    await controller.stop();

    expect(controller.inspect()).toEqual({ time: 0, variables: {}, sentEvents: [] });
  });
});

describe("PlayController stop() (PC-003/PC-006/PC-007)", () => {
  it("restores via renderHost.loadScene(capturedDocumentJson) captured at start(), not whatever getDocumentJson returns later", async () => {
    const loadSceneCalls: unknown[] = [];
    const startJson = tickCounterGltfJson();
    let currentJson: unknown = startJson;
    const controller = createPlayController({
      renderHost: makeFakeRenderHost({
        loadScene: async (json) => {
          loadSceneCalls.push(json);
        }
      }),
      getDocumentJson: () => currentJson,
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    currentJson = { asset: { version: "2.0" } }; // simulate the getter now returning something different
    await controller.stop();

    expect(loadSceneCalls).toEqual([startJson]);
  });

  it("is idempotent: a second stop() does not re-invoke loadScene", async () => {
    let loadSceneCallCount = 0;
    const controller = createPlayController({
      renderHost: makeFakeRenderHost({
        loadScene: async () => {
          loadSceneCallCount += 1;
        }
      }),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.start({ engine: "interpreter" });
    await controller.stop();
    await controller.stop();

    expect(loadSceneCallCount).toBe(1);
  });

  it("state moves to \"stopped\" synchronously, even while the loadScene restore promise is still pending", async () => {
    let resolveLoadScene: () => void = () => {};
    const controller = createPlayController({
      renderHost: makeFakeRenderHost({
        loadScene: () =>
          new Promise<void>((resolve) => {
            resolveLoadScene = resolve;
          })
      }),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    }) as PlayControllerImpl;

    await controller.start({ engine: "interpreter" });
    const stopPromise = controller.stop();
    expect(controller.getPlayState()).toBe("stopped");
    resolveLoadScene();
    await stopPromise;
  });

  it("calling stop() before ever calling start() resolves immediately and does not call loadScene", async () => {
    let loadSceneCallCount = 0;
    const controller = createPlayController({
      renderHost: makeFakeRenderHost({
        loadScene: async () => {
          loadSceneCallCount += 1;
        }
      }),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    await controller.stop();
    expect(loadSceneCallCount).toBe(0);
  });
});

describe("PlayController pause/resume/tickOnce state machine", () => {
  it("tickOnce() is a no-op while playing or stopped", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });

    // stopped: no-op, no throw.
    controller.tickOnce();
    expect(controller.inspect()).toEqual({ time: 0, variables: {}, sentEvents: [] });

    await controller.start({ engine: "interpreter" });
    // playing: no-op (the scheduled loop is what ticks; tickOnce is a no-op here).
    controller.tickOnce();
    expect(controller.inspect().variables.counter).toEqual({ type: "int", data: [0] });
  });

  it("pause() is a no-op (not a throw) when already paused or stopped", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });
    expect(() => controller.pause()).not.toThrow(); // stopped
    await controller.start({ engine: "interpreter" });
    controller.pause();
    expect(() => controller.pause()).not.toThrow(); // already paused
  });

  it("resume() is a no-op when playing or stopped", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });
    expect(() => controller.resume()).not.toThrow(); // stopped
    await controller.start({ engine: "interpreter" });
    expect(() => controller.resume()).not.toThrow(); // already playing
  });
});

describe("PlayController fireSelect/fireHoverIn/fireHoverOut (PC-008)", () => {
  it("are no-ops while stopped (no throw)", () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });
    expect(() => controller.fireSelect(0, [0, 0, 0])).not.toThrow();
    expect(() => controller.fireHoverIn(0)).not.toThrow();
    expect(() => controller.fireHoverOut()).not.toThrow();
  });

  it("delegate to the active engine without throwing while playing/paused", async () => {
    const controller = createPlayController({
      renderHost: makeFakeRenderHost(),
      getDocumentJson: () => tickCounterGltfJson(),
      scheduler: makeManualScheduler()
    });
    await controller.start({ engine: "interpreter" });
    expect(() => controller.fireSelect(0, [1, 2, 3])).not.toThrow();
    expect(() => controller.fireHoverIn(0, [1, 2, 3])).not.toThrow();
    expect(() => controller.fireHoverOut(0)).not.toThrow();
    controller.pause();
    expect(() => controller.fireHoverOut()).not.toThrow();
  });
});
