import { describe, expect, it } from "vitest";
import type {
  CameraPose,
  GizmoChangeEvent,
  GizmoMode,
  JsonPatchOp,
  PatchOutcome,
  PickResult,
  PlayController,
  RenderHost
} from "@gltf-studio/engine-api";

/**
 * PlayController contract obligations, transcribed from Phase A. One
 * fan-out SceneAdapter.applyPointer -> renderHost ‖ audioHost is assumed
 * by the plan but is an engine-three/audio-webaudio integration concern,
 * not directly assertable against PlayController alone; obligations below
 * are the ones PlayController itself owns.
 */
export const playControllerContractObligations: string[] = [
  'start({ engine: "interpreter" }) begins ticking without throwing (PC-001)',
  'start({ engine: "compiled" }) begins ticking without throwing (PC-001)',
  "pause stops ticking until resume is called",
  "resume continues ticking from where pause left off",
  "tickOnce advances exactly one tick while paused",
  "stop() contractually reloads the scene snapshot (PC-003)",
  "stop() after stop() (already stopped) does not throw",
  "inspect() reports time/variables/sentEvents consistent with ticks that have occurred",
  "onDiagnostic handlers fire for diagnostics raised during play",
  "the unsubscribe function returned by onDiagnostic stops further delivery",
  "production default scheduler (real requestAnimationFrame/setTimeout) ticks the engine eventually (smoke)"
];

/**
 * The pointer address `contractGraphJson`'s graph writes on every tick.
 * Consumers wiring a `PlayControllerHarness` for this contract are expected
 * to build their `RenderHostSpy` with `createFakeRenderHost({ throwOnPointer:
 * CONTRACT_UNHANDLED_POINTER })` so the "onDiagnostic" obligations below have
 * something to observe.
 */
export const CONTRACT_UNHANDLED_POINTER = "/test/unhandled";

/**
 * onTick -> variable/get(counter) -> math/add(+1) -> variable/set(counter)
 * -> pointer/set(CONTRACT_UNHANDLED_POINTER, 42). One linear flow chain
 * (the same proven op/config/value/flow shapes as
 * packages/play/src/test-fixtures.ts's tickCounterGltfJson and
 * onTickPointerSetGltfJson, concatenated into a single chain rather than
 * imported — this package must not depend on @gltf-studio/play, which
 * depends on this package instead) that increments `counter` by 1 AND
 * writes a pointer every tick, so a single harness/document can serve every
 * obligation below (`makeHarness()` takes no per-test arguments).
 */
export function contractGraphJson(pointer: string = CONTRACT_UNHANDLED_POINTER, pointerValue = 42): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "int" }],
            variables: [{ id: "counter", type: 0, value: [0] }],
            events: [],
            declarations: [
              { op: "event/onTick" },
              { op: "variable/get" },
              { op: "math/add" },
              { op: "variable/set" },
              { op: "pointer/set" }
            ],
            nodes: [
              { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 3, socket: "in" } } },
              { declaration: 1, configuration: { variable: { value: [0] } }, values: {}, flows: {} },
              {
                declaration: 2,
                configuration: {},
                values: { a: { node: 1, socket: "value" }, b: { type: 0, value: [1] } },
                flows: {}
              },
              {
                declaration: 3,
                configuration: { variables: { value: [0] } },
                values: { "0": { node: 2, socket: "value" } },
                flows: { out: { node: 4, socket: "in" } }
              },
              {
                declaration: 4,
                configuration: { pointer: { value: [pointer] }, type: { value: [0] } },
                values: { value: { type: 0, value: [pointerValue] } },
                flows: {}
              }
            ]
          }
        ]
      }
    }
  };
}

/**
 * A fake `RenderHost` that records `loadScene` calls and otherwise
 * no-ops/returns sensible fixed defaults — good enough for
 * `PlayController`'s own contract, which never needs a real
 * canvas/WebGL/DOM (that's `describeRenderHostContract`'s job, over in
 * render-host.ts). Exported in case a future consumer wants it, but only
 * this package's own consumers (packages/play) currently use it.
 */
export interface RenderHostSpy extends RenderHost {
  readonly loadSceneCalls: unknown[];
}

const FIXED_CAMERA_POSE: CameraPose = { position: [0, 0, 3], rotation: [0, 0, 0, 1], target: [0, 0, 0] };

export function createFakeRenderHost(options?: { throwOnPointer?: string }): RenderHostSpy {
  const loadSceneCalls: unknown[] = [];
  let cameraPose: CameraPose = FIXED_CAMERA_POSE;
  return {
    loadSceneCalls,
    mount(): void {},
    async loadScene(json: unknown): Promise<void> {
      loadSceneCalls.push(json);
    },
    dispose(): void {},
    patchScene(_patches: JsonPatchOp[]): PatchOutcome {
      return "applied";
    },
    pick(_x: number, _y: number): PickResult | null {
      return null;
    },
    getCameraPose(): CameraPose {
      return cameraPose;
    },
    setCameraPose(pose: CameraPose): void {
      cameraPose = pose;
    },
    attachGizmo(_nodeIndex: number, _mode: GizmoMode): void {},
    detachGizmo(): void {},
    onGizmoChange(_handler: (event: GizmoChangeEvent) => void): () => void {
      return () => {};
    },
    applyPointer(pointer: string, _value: unknown): void {
      if (options?.throwOnPointer !== undefined && pointer === options.throwOnPointer) {
        throw new Error(`fake RenderHost: refusing to apply pointer ${pointer}`);
      }
    },
    setHighlight(_nodeIndices: number[]): void {},
    setReferenceHighlight(_nodeIndices: number[]): void {},
    async snapshot(): Promise<Blob> {
      return new Blob([], { type: "image/png" });
    }
  };
}

export interface PlayControllerHarness {
  controller: PlayController;
  renderHost: RenderHostSpy;
  /** The exact document JSON the harness configured the controller's `getDocumentJson()` to return — tests compare this against `renderHost.loadSceneCalls` entries. */
  documentJson: unknown;
  /**
   * The `ManualFrameScheduler` (see below) `controller` was constructed
   * with. Every PRECISE timing assertion in this contract (pause/resume's
   * "ticking did/didn't happen") drives ticks explicitly through this
   * rather than depending on real `requestAnimationFrame`/`setTimeout`
   * cadence — see `createManualFrameScheduler`'s doc comment for why.
   */
  scheduler: ManualFrameScheduler;
}

/**
 * A structural match for `@gltf-studio/play`'s own `FrameScheduler`
 * interface (this package cannot import it — see `contractGraphJson`'s doc
 * comment above on the one-way dependency direction — but TypeScript's
 * structural typing makes an object of this shape assignable to
 * `PlayControllerDeps.scheduler` regardless), plus one test-only control
 * method (`fireFrame`) and one test-only observer (`hasPendingFrame`)
 * neither real implementation has.
 */
export interface ManualFrameScheduler {
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  /** True while a `requestFrame` callback is queued and not yet fired or cancelled. */
  hasPendingFrame(): boolean;
  /**
   * Advances the manual clock by `dtMs` (default: one 60fps frame interval)
   * and synchronously invokes the currently-pending `requestFrame` callback
   * with the new `now()`. Throws if nothing is pending (a test asserting
   * "no more ticks should happen" should check `hasPendingFrame()` instead
   * of calling this and expecting it to silently no-op).
   */
  fireFrame(dtMs?: number): void;
}

/**
 * Real-Chromium/browser-mode (`packages/play/test/contract.test.ts`) and
 * plain-Node (`packages/play/src/contract.test.ts`) contract runs both
 * flaked under CPU contention before this scheduler existed: the contract
 * used to `await` a fixed real-clock delay (e.g. 80ms) and then assert
 * either equality ("no tick happened") or `toBeGreaterThan` ("a tick did
 * happen") against `PlayController.inspect().time`. Under load, a headless
 * Chromium's `requestAnimationFrame` (and Node's `setTimeout` scheduler
 * fallback) can simply not fire within an arbitrary wall-clock window —
 * that isn't a bug in `PlayController`, just an environment that got busy —
 * so `toBeGreaterThan(pausedTime)` failed with `0 > 0` under contention (see
 * this fix's PR description for the exact reproduction). Root cause is
 * READINESS/DETERMINISM, not a wider tolerance or a retry: this manual
 * scheduler lets every precise assertion below drive the exact tick it
 * needs via `fireFrame()` and check `hasPendingFrame()` for "did
 * pause()/resume() (de)schedule the next frame" instead of inferring it
 * from real elapsed time. The one remaining real-scheduler assertion
 * (`makeRealSchedulerHarness`, below) is deliberately loose: "ticks happen
 * at all, eventually" via `expect.poll` with a generous deadline, proving
 * the production `createDefaultScheduler()` wiring for real without
 * depending on hitting a fixed window.
 */
export function createManualFrameScheduler(): ManualFrameScheduler {
  let now = 0;
  let nextHandle = 1;
  let pending: { handle: number; callback: (now: number) => void } | null = null;
  return {
    now: () => now,
    requestFrame(callback) {
      const handle = nextHandle++;
      pending = { handle, callback };
      return handle;
    },
    cancelFrame(handle) {
      if (pending?.handle === handle) {
        pending = null;
      }
    },
    hasPendingFrame() {
      return pending !== null;
    },
    fireFrame(dtMs = 1000 / 60) {
      if (!pending) {
        throw new Error("createManualFrameScheduler: fireFrame() called with no pending requestFrame() callback.");
      }
      now += dtMs;
      const { callback } = pending;
      pending = null;
      callback(now);
    }
  };
}

/**
 * `PlayInspection.variables`' values are whatever the underlying engine's
 * `getVariableByIndex`/equivalent returns — for both engine kinds here
 * (`@gltfi/runtime`'s `EngineInteractive`), that's a tagged `Value = {
 * type: ValueType; data: number[] | boolean[] | string[] }` rather than a
 * bare scalar. Unwraps the first `data` element for a scalar `int`
 * variable like `contractGraphJson`'s `counter`, falling back to the raw
 * value in case a future engine implementation reports plain scalars.
 */
function numericVariableValue(value: unknown): number {
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data: unknown }).data;
    if (Array.isArray(data)) return data[0] as number;
  }
  return value as number;
}

/**
 * The compiled engine's `import "@gltfi/runtime-lib"` bare specifier can
 * only resolve if the CURRENT document actually ships an import map for it
 * (see packages/app/index.html + packages/app/scripts/bundle-runtime-lib.mjs,
 * proven end-to-end by e2e/play.spec.ts's "compiled engine parity" test).
 * Checking for that import map directly — rather than just "is this a real
 * DOM" — is what lets this obligation tell apart a real app environment
 * (import map present, should run for real) from vitest's own browser-mode
 * tester page (real DOM, but no import map at all, and vitest 2.1.9 gives no
 * way to inject one — see packages/play/test/contract.test.ts, which runs
 * this suite under vitest browser mode and would otherwise fail here with a
 * "Failed to resolve module specifier" TypeError that is a test-harness
 * limitation, not a PlayController defect).
 */
function canResolveRuntimeLibImportMap(): boolean {
  if (typeof document === "undefined") return false;
  const importMapScript = document.querySelector('script[type="importmap"]');
  if (!importMapScript?.textContent) return false;
  try {
    const parsed = JSON.parse(importMapScript.textContent) as { imports?: Record<string, string> };
    return typeof parsed.imports?.["@gltfi/runtime-lib"] === "string";
  } catch {
    return false;
  }
}

export function describePlayControllerContract(
  makeHarness: () => PlayControllerHarness,
  /**
   * Builds a controller using the REAL production `FrameScheduler`
   * (`createDefaultScheduler()` — real `requestAnimationFrame` in a
   * browser, a ~60fps `setTimeout` fallback in Node) for exactly ONE loose
   * smoke assertion ("ticks happen at all, eventually"); every other
   * assertion in this suite drives ticks through `makeHarness()`'s
   * `ManualFrameScheduler` instead (see that type's doc comment for why).
   * Optional so a consumer that hasn't wired a second harness factory yet
   * degrades to skipping the smoke test rather than hard-failing.
   */
  makeRealSchedulerHarness?: () => Pick<PlayControllerHarness, "controller">
): void {
  // Node can't do this at all (ERR_UNSUPPORTED_ESM_URL_SCHEME) — a DOM is a
  // prerequisite — but a DOM alone isn't sufficient: only run this
  // obligation for real when the current document's import map can actually
  // resolve "@gltfi/runtime-lib" (see canResolveRuntimeLibImportMap above).
  const canRunCompiled = typeof window !== "undefined" && typeof document !== "undefined" && canResolveRuntimeLibImportMap();

  describe("PlayController contract", () => {
    it('start({ engine: "interpreter" }) begins ticking without throwing (PC-001)', async () => {
      const { controller } = makeHarness();
      await expect(controller.start({ engine: "interpreter" })).resolves.toBeUndefined();
      await controller.stop();
    });

    // it.skip (not it.todo): this obligation DOES have a real assertion
    // below — it only skips when the current document has no import map
    // that resolves "@gltfi/runtime-lib" (plain Node, and also vitest's own
    // browser-mode tester page in packages/play/test/contract.test.ts, which
    // has a real DOM but no importmap at all — vitest 2.1.9 provides no way
    // to inject one). A real app environment serving packages/app's actual
    // index.html (with its build-time-generated import map) would run this
    // for real; see e2e/play.spec.ts's "compiled engine parity" test for
    // that proof, run outside vitest entirely via Playwright.
    (canRunCompiled ? it : it.skip)(
      'start({ engine: "compiled" }) begins ticking without throwing (PC-001)',
      async () => {
        const { controller } = makeHarness();
        await expect(controller.start({ engine: "compiled" })).resolves.toBeUndefined();
        await controller.stop();
      }
    );

    it("pause stops ticking until resume is called", async () => {
      const { controller, scheduler } = makeHarness();
      await controller.start({ engine: "interpreter" });
      scheduler.fireFrame();
      const beforePause = controller.inspect().time;
      controller.pause();
      // Direct proof no more ticks will happen: pause() must not leave a
      // frame request in flight, rather than inferring "no ticking" from
      // the ABSENCE of a time change over an arbitrary real-clock wait
      // (that inference is sound either way, but the real-clock wait it
      // used to depend on is what flaked under CPU contention pre-fix —
      // see createManualFrameScheduler's doc comment).
      expect(scheduler.hasPendingFrame()).toBe(false);
      expect(controller.inspect().time).toBe(beforePause);
      await controller.stop();
    });

    it("resume continues ticking from where pause left off", async () => {
      const { controller, scheduler } = makeHarness();
      await controller.start({ engine: "interpreter" });
      scheduler.fireFrame();
      controller.pause();
      const pausedTime = controller.inspect().time;
      controller.resume();
      // resume() must immediately re-arm ticking — assert the scheduler has
      // a pending frame request queued (proof ticking resumed) before
      // manually driving it, rather than depending on real rAF/setTimeout
      // cadence firing within an arbitrary wall-clock window (the exact
      // mechanism behind this suite's recurring real-Chromium CI flake:
      // under CPU contention, zero ticks could land within the old fixed
      // wait, so `inspect().time` stayed equal to `pausedTime` and
      // `toBeGreaterThan` failed with "0 > 0").
      expect(scheduler.hasPendingFrame()).toBe(true);
      scheduler.fireFrame();
      expect(controller.inspect().time).toBeGreaterThan(pausedTime);
      await controller.stop();
    });

    it("tickOnce advances exactly one tick while paused", async () => {
      const { controller } = makeHarness();
      await controller.start({ engine: "interpreter" });
      controller.pause();
      const t0 = controller.inspect().time;
      controller.tickOnce();
      const t1 = controller.inspect().time;
      controller.tickOnce();
      const t2 = controller.inspect().time;
      const firstDelta = t1 - t0;
      const secondDelta = t2 - t1;
      expect(firstDelta).toBeGreaterThan(0);
      expect(secondDelta).toBeCloseTo(firstDelta, 10);
      await controller.stop();
    });

    it("stop() contractually reloads the scene snapshot (PC-003)", async () => {
      const { controller, renderHost, documentJson, scheduler } = makeHarness();
      await controller.start({ engine: "interpreter" });
      scheduler.fireFrame();
      const before = renderHost.loadSceneCalls.length;
      await controller.stop();
      expect(renderHost.loadSceneCalls.length).toBe(before + 1);
      expect(renderHost.loadSceneCalls[renderHost.loadSceneCalls.length - 1]).toEqual({ json: documentJson, binary: undefined });
    });

    it("stop() after stop() (already stopped) does not throw", async () => {
      const { controller, renderHost } = makeHarness();
      await controller.start({ engine: "interpreter" });
      await controller.stop();
      const callsAfterFirstStop = renderHost.loadSceneCalls.length;
      await expect(controller.stop()).resolves.toBeUndefined();
      expect(renderHost.loadSceneCalls.length).toBe(callsAfterFirstStop);
    });

    it("inspect() reports time/variables/sentEvents consistent with ticks that have occurred", async () => {
      const { controller } = makeHarness();
      await controller.start({ engine: "interpreter" });
      controller.pause();
      const startCounter = numericVariableValue(controller.inspect().variables.counter);
      controller.tickOnce();
      controller.tickOnce();
      controller.tickOnce();
      const inspection = controller.inspect();
      expect(numericVariableValue(inspection.variables.counter)).toBe(startCounter + 3);
      expect(inspection.time).toBeGreaterThan(0);
      expect(Array.isArray(inspection.sentEvents)).toBe(true);
      await controller.stop();
    });

    it("onDiagnostic handlers fire for diagnostics raised during play", async () => {
      const { controller } = makeHarness();
      await controller.start({ engine: "interpreter" });
      controller.pause();
      const diagnostics: Array<{ kind: string; pointer?: string }> = [];
      controller.onDiagnostic((diagnostic) => {
        diagnostics.push(diagnostic);
      });
      controller.tickOnce();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].kind).toBe("unhandled-pointer");
      expect(diagnostics[0].pointer).toBe(CONTRACT_UNHANDLED_POINTER);
      await controller.stop();
    });

    it("the unsubscribe function returned by onDiagnostic stops further delivery", async () => {
      const { controller } = makeHarness();
      await controller.start({ engine: "interpreter" });
      controller.pause();
      let callCount = 0;
      const unsubscribe = controller.onDiagnostic(() => {
        callCount++;
      });
      controller.tickOnce();
      const countAtUnsubscribe = callCount;
      expect(countAtUnsubscribe).toBeGreaterThan(0);
      unsubscribe();
      controller.tickOnce();
      expect(callCount).toBe(countAtUnsubscribe);
      await controller.stop();
    });

    // it.skip (not it.todo): a consumer that hasn't wired a
    // makeRealSchedulerHarness second factory yet just skips this one
    // instead of failing — every consumer as of this fix (both
    // packages/play contract.test.ts files) does provide it. Deliberately
    // loose (expect.poll with a generous deadline, "greater than 0" rather
    // than an exact tick count or dt value) — this is the ONE assertion in
    // the suite allowed to depend on real requestAnimationFrame/setTimeout
    // cadence, proving createDefaultScheduler()'s production wiring
    // actually ticks the engine for real. Every assertion that needs
    // PRECISE tick timing uses makeHarness()'s ManualFrameScheduler instead
    // (see that type's doc comment for the CI flake this split fixes).
    (makeRealSchedulerHarness ? it : it.skip)(
      "production default scheduler (real requestAnimationFrame/setTimeout) ticks the engine eventually (smoke)",
      async () => {
        const { controller } = makeRealSchedulerHarness!();
        await controller.start({ engine: "interpreter" });
        await expect.poll(() => controller.inspect().time, { timeout: 4000, interval: 25 }).toBeGreaterThan(0);
        await controller.stop();
      }
    );
  });
}
