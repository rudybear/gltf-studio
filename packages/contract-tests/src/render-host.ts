/// <reference types="@vitest/browser/providers/playwright" />
import { describe, expect, it } from "vitest";
import type { CameraPose, RenderHost } from "@gltf-studio/engine-api";
import { lookAtQuaternion, worldDirectionToScreen, type Vec3 } from "./internal/vec-math.js";

/**
 * RenderHost contract obligations, transcribed from Phase A of the program
 * plan. Kept as a plain string list (matching each real test's title below)
 * so `self-check.test.ts` can assert the inventory is non-empty without
 * depending on vitest's own suite-introspection APIs.
 */
export const renderHostContractObligations: string[] = [
  "mount is idempotent: calling mount() twice does not throw or double-attach (RH-004)",
  "loadScene resolves once the scene is ready for pick/patchScene calls (RH-007)",
  "dispose is idempotent: calling dispose() twice does not throw (RH-005)",
  "dispose after mount without a prior loadScene does not throw (RH-006)",
  "calling loadScene again while a scene is already loaded replaces it (RH-008)",
  "calling mount again with a different container detaches from the previous one (RH-009)",
  "mount after dispose re-initializes the RenderHost for reuse (RH-010)",
  'patchScene returns "applied" for a non-structural patch (RH-001)',
  'patchScene returns "needs-reload" for a structural patch (RH-001)',
  "patchScene classifies an add/remove/move on an array as structural (RH-011)",
  "patchScene classifies any op under /nodes, /scenes, /scene, or /meshes as structural (RH-012)",
  "patchScene classifies a replace on a leaf field as non-structural (RH-013)",
  'patchScene returns "needs-reload" for a batch if any one patch in it is structural (RH-014)',
  "pick returns null when nothing is under the given NDC coordinates (RH-015)",
  "pick returns a PickResult with the correct nodeIndex for a hit at NDC coordinates (RH-015)",
  "pick() honors KHR_node_selectability by default: a non-selectable node under the cursor is not picked (RH-027)",
  "pick(x, y, { ignoreEligibility: true }) picks a non-selectable node under the cursor, still gated by visibility (RH-027)",
  "getCameraPose/setCameraPose round-trip position and rotation (RH-016, RH-017)",
  "attachGizmo accepts a GizmoMode of translate, rotate, or scale (RH-018)",
  "attachGizmo while a gizmo is already attached replaces it without an explicit detach (RH-019)",
  "detachGizmo removes any attached gizmo and is a no-op when none is attached (RH-025)",
  'attachGizmo + onGizmoChange emits phase "drag" while dragging and phase "commit" exactly once on release (RH-003)',
  "applyPointer writes the given pointer/value without requiring a reload (RH-020)",
  "applyPointer does not create a HistoryStack entry (RH-021)",
  "setHighlight(indices) highlights exactly the given node indices (RH-022)",
  "setHighlight([]) clears all highlighting (RH-023)",
  "setReferenceHighlight(indices) highlights exactly the given node indices, independent of setHighlight's own set (RH-029)",
  "setReferenceHighlight([]) clears reference highlighting without touching setHighlight's set (RH-030)",
  "snapshot() after loadScene resolves to a PNG Blob at the canvas's current resolution (RH-024)",
  "setEditorHelpers(descriptors) does not throw, including for an unknown kind or an unresolvable nodeIndex (RH-032)",
  "setEditorHelpers([]) clears any previously-set helpers without throwing (RH-033)"
];

/**
 * A tiny, self-contained (no external binary — the buffer is a base64
 * `data:` URI, per glTF's "embedded" convention) two-node glTF fixture,
 * built fresh with plain JS/DOM APIs (`btoa`) so this package stays
 * dependency-free beyond `@gltf-studio/engine-api` + vitest and usable
 * against *any* RenderHost implementation whose `loadScene` accepts plain
 * glTF JSON (the most portable of engine-three's accepted input shapes —
 * see specs/render-host.md's "Open questions").
 *
 *   node 0 "Hit"   — a flat, double-sided triangle spanning roughly
 *                    [-1,1]x[-1,1] at z=0, centered at the world origin.
 *   node 1 "Decoy" — the same geometry, translated to [10, 10, 10] so it
 *                    never intersects a ray from the fixed camera poses
 *                    these tests use.
 */
export const FIXTURE_HIT_NODE_INDEX = 0;
export const FIXTURE_DECOY_NODE_INDEX = 1;

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function buildFixtureGltfJson(): unknown {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + normalBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(normalBytes, positionBytes.byteLength);

  return {
    asset: { version: "2.0", generator: "gltf-studio contract-tests fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Hit", mesh: 0, translation: [0, 0, 0] },
      { name: "Decoy", mesh: 1, translation: [10, 10, 10] }
    ],
    meshes: [
      { name: "HitMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] },
      { name: "DecoyMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }
    ],
    materials: [
      {
        name: "FixtureRed",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: normalBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }]
  };
}

/**
 * Same fixture as `buildFixtureGltfJson()` (identical geometry/material/
 * accessors) except node 0 ("Hit") also carries `KHR_node_selectability`'s
 * `selectable: false` — used by the RH-027 tests below to prove `pick()`'s
 * default eligibility gate excludes it while `ignoreEligibility: true`
 * bypasses that gate. Node 1 ("Decoy") is unchanged (still selectable by
 * default — KHR_node_selectability's absence means selectable).
 */
export function buildFixtureGltfJsonWithNonSelectableHitNode(): unknown {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + normalBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(normalBytes, positionBytes.byteLength);

  return {
    asset: { version: "2.0", generator: "gltf-studio contract-tests fixture" },
    extensionsUsed: ["KHR_node_selectability"],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Hit", mesh: 0, translation: [0, 0, 0], extensions: { KHR_node_selectability: { selectable: false } } },
      { name: "Decoy", mesh: 1, translation: [10, 10, 10] }
    ],
    meshes: [
      { name: "HitMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] },
      { name: "DecoyMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }
    ],
    materials: [
      {
        name: "FixtureRed",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: normalBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }]
  };
}

/** Camera looking straight down -Z at the world origin from (0, 0, 3) — node 0 dead center, node 1 nowhere in frame. */
const FRONT_CAMERA_POSE: CameraPose = { position: [0, 0, 3], rotation: [0, 0, 0, 1], target: [0, 0, 0] };

/** A diagonal camera pose (all three world axes visible/distinguishable on screen) for the gizmo drag test. */
const DIAGONAL_CAMERA_POSITION: Vec3 = [2.4, 2, 2.6];
const DIAGONAL_CAMERA_TARGET: Vec3 = [0, 0, 0];
const DIAGONAL_CAMERA_POSE: CameraPose = {
  position: DIAGONAL_CAMERA_POSITION,
  rotation: lookAtQuaternion(DIAGONAL_CAMERA_POSITION, DIAGONAL_CAMERA_TARGET),
  target: DIAGONAL_CAMERA_TARGET
};

function isDomAvailable(): boolean {
  return typeof document !== "undefined" && typeof HTMLElement !== "undefined" && typeof ResizeObserver !== "undefined";
}

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "480px";
  container.style.height = "360px";
  document.body.appendChild(container);
  return container;
}

async function mountedHost(makeHost: () => RenderHost): Promise<{ host: RenderHost; container: HTMLElement }> {
  const host = makeHost();
  const container = createContainer();
  host.mount(container);
  return { host, container };
}

async function loadFixture(host: RenderHost): Promise<void> {
  await host.loadScene(buildFixtureGltfJson());
}

function teardown(host: RenderHost, container: HTMLElement): void {
  host.dispose();
  container.remove();
}

/**
 * Dispatches a real, OS-level mouse gesture via the browser automation
 * driver's CDP session (NOT a synthetic `element.dispatchEvent(new
 * PointerEvent(...))`) — a plain JS-dispatched PointerEvent's `pointerId`
 * is not a real "active pointer" as far as Chromium's own pointer-capture
 * tracking is concerned, so `Element.setPointerCapture` (which three.js's
 * TransformControls calls on pointerdown) would throw and silently abort
 * the gesture. Real CDP-injected input has no such problem — it's what
 * Playwright's own `page.mouse` API uses under the hood, and the
 * `cdp()` escape hatch is what `@vitest/browser/context` exposes for it.
 * Dynamically imported so this module has no *load-time* dependency on
 * `@vitest/browser` (only real-DOM tests, already gated by
 * `isDomAvailable()`, ever call this) — importing `@vitest/browser/context`
 * eagerly would break `packages/contract-tests/src/self-check.test.ts`,
 * which instantiates this suite under vitest's plain Node environment.
 */
async function dispatchMouseGesture(steps: Array<{ type: "mousePressed" | "mouseMoved" | "mouseReleased"; x: number; y: number }>): Promise<void> {
  const { cdp } = await import("@vitest/browser/context");
  const session = cdp();
  for (const step of steps) {
    await session.send("Input.dispatchMouseEvent", {
      type: step.type,
      x: step.x,
      y: step.y,
      button: "left",
      buttons: step.type === "mouseReleased" ? 0 : 1,
      clickCount: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

export function describeRenderHostContract(makeHost: () => RenderHost): void {
  const domAvailable = isDomAvailable();
  // it.skip (not it.todo): these obligations DO have real assertions below —
  // they only skip when this suite is instantiated outside a real DOM/canvas
  // environment (see packages/contract-tests/src/self-check.test.ts, which
  // runs under vitest's plain Node environment and passes a `makeHost` that
  // just throws). The real, exercised run lives in
  // packages/engine-three/test/contract.test.ts (vitest browser mode, real
  // Chromium + WebGL).
  const test = domAvailable ? it : it.skip;

  describe("RenderHost contract", () => {
    test("mount is idempotent: calling mount() twice does not throw or double-attach (RH-004)", () => {
      const host = makeHost();
      const container = createContainer();
      expect(() => {
        host.mount(container);
        host.mount(container);
      }).not.toThrow();
      expect(container.querySelectorAll("canvas").length).toBe(1);
      teardown(host, container);
    });

    test("loadScene resolves once the scene is ready for pick/patchScene calls (RH-007)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await expect(loadFixture(host)).resolves.toBeUndefined();
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(host.pick(0, 0)).not.toBeNull();
      expect(() => host.patchScene([])).not.toThrow();
      teardown(host, container);
    });

    test("dispose is idempotent: calling dispose() twice does not throw (RH-005)", () => {
      const host = makeHost();
      const container = createContainer();
      host.mount(container);
      host.dispose();
      expect(() => host.dispose()).not.toThrow();
      container.remove();
    });

    test("dispose after mount without a prior loadScene does not throw (RH-006)", () => {
      const host = makeHost();
      const container = createContainer();
      host.mount(container);
      expect(() => host.dispose()).not.toThrow();
      container.remove();
    });

    test("calling loadScene again while a scene is already loaded replaces it (RH-008)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(host.pick(0, 0)?.nodeIndex).toBe(FIXTURE_HIT_NODE_INDEX);
      await expect(loadFixture(host)).resolves.toBeUndefined();
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(host.pick(0, 0)?.nodeIndex).toBe(FIXTURE_HIT_NODE_INDEX);
      teardown(host, container);
    });

    test("calling mount again with a different container detaches from the previous one (RH-009)", () => {
      const host = makeHost();
      const containerA = createContainer();
      const containerB = createContainer();
      host.mount(containerA);
      expect(containerA.querySelectorAll("canvas").length).toBe(1);
      host.mount(containerB);
      expect(containerA.querySelectorAll("canvas").length).toBe(0);
      expect(containerB.querySelectorAll("canvas").length).toBe(1);
      host.dispose();
      containerA.remove();
      containerB.remove();
    });

    test("mount after dispose re-initializes the RenderHost for reuse (RH-010)", async () => {
      const host = makeHost();
      const container = createContainer();
      host.mount(container);
      await loadFixture(host);
      host.dispose();
      expect(container.querySelectorAll("canvas").length).toBe(0);
      expect(() => host.mount(container)).not.toThrow();
      expect(container.querySelectorAll("canvas").length).toBe(1);
      await expect(loadFixture(host)).resolves.toBeUndefined();
      teardown(host, container);
    });

    test('patchScene returns "applied" for a non-structural patch (RH-001)', async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      const outcome = host.patchScene([{ op: "replace", path: "/nodes/0/translation", value: [1, 2, 3] }]);
      expect(outcome).toBe("applied");
      teardown(host, container);
    });

    test('patchScene returns "needs-reload" for a structural patch (RH-001)', async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      const outcome = host.patchScene([{ op: "add", path: "/nodes/-", value: { name: "New" } }]);
      expect(outcome).toBe("needs-reload");
      teardown(host, container);
    });

    test("patchScene classifies an add/remove/move on an array as structural (RH-011)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(host.patchScene([{ op: "remove", path: "/nodes/1" }])).toBe("needs-reload");
      expect(host.patchScene([{ op: "move", from: "/nodes/1", path: "/nodes/0" }])).toBe("needs-reload");
      teardown(host, container);
    });

    test("patchScene classifies any op under /nodes, /scenes, /scene, or /meshes as structural (RH-012)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(host.patchScene([{ op: "replace", path: "/scene", value: 0 }])).toBe("needs-reload");
      expect(host.patchScene([{ op: "replace", path: "/meshes", value: [] }])).toBe("needs-reload");
      teardown(host, container);
    });

    test("patchScene classifies a replace on a leaf field as non-structural (RH-013)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(host.patchScene([{ op: "replace", path: "/nodes/0/translation", value: [0, 0, 1] }])).toBe("applied");
      teardown(host, container);
    });

    test('patchScene returns "needs-reload" for a batch if any one patch in it is structural (RH-014)', async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      const outcome = host.patchScene([
        { op: "replace", path: "/nodes/0/translation", value: [0, 0, 1] },
        { op: "remove", path: "/nodes/1" }
      ]);
      expect(outcome).toBe("needs-reload");
      teardown(host, container);
    });

    test("pick returns null when nothing is under the given NDC coordinates (RH-015)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(host.pick(0.95, 0.95)).toBeNull();
      teardown(host, container);
    });

    test("pick returns a PickResult with the correct nodeIndex for a hit at NDC coordinates (RH-015)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setCameraPose(FRONT_CAMERA_POSE);
      const result = host.pick(0, 0);
      expect(result?.nodeIndex).toBe(FIXTURE_HIT_NODE_INDEX);
      expect(result?.point).toHaveLength(3);
      expect(typeof result?.distance).toBe("number");
      teardown(host, container);
    });

    test("pick() honors KHR_node_selectability by default: a non-selectable node under the cursor is not picked (RH-027)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await host.loadScene(buildFixtureGltfJsonWithNonSelectableHitNode());
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(host.pick(0, 0)).toBeNull();
      teardown(host, container);
    });

    test("pick(x, y, { ignoreEligibility: true }) picks a non-selectable node under the cursor, still gated by visibility (RH-027)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await host.loadScene(buildFixtureGltfJsonWithNonSelectableHitNode());
      host.setCameraPose(FRONT_CAMERA_POSE);
      const result = host.pick(0, 0, { ignoreEligibility: true });
      expect(result?.nodeIndex).toBe(FIXTURE_HIT_NODE_INDEX);
      // Empty space (no geometry at all) still misses even with eligibility ignored.
      expect(host.pick(0.95, 0.95, { ignoreEligibility: true })).toBeNull();
      teardown(host, container);
    });

    test("getCameraPose/setCameraPose round-trip position and rotation (RH-016, RH-017)", () => {
      const host = makeHost();
      const container = createContainer();
      host.mount(container);
      const pose: CameraPose = { position: [1, 2, 3], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], target: [0, 0, 0] };
      host.setCameraPose(pose);
      const readBack = host.getCameraPose();
      for (let i = 0; i < 3; i++) expect(readBack.position[i]).toBeCloseTo(pose.position[i], 5);
      for (let i = 0; i < 4; i++) expect(readBack.rotation[i]).toBeCloseTo(pose.rotation[i], 5);
      teardown(host, container);
    });

    test("attachGizmo accepts a GizmoMode of translate, rotate, or scale (RH-018)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(() => host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "translate")).not.toThrow();
      expect(() => host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "rotate")).not.toThrow();
      expect(() => host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "scale")).not.toThrow();
      teardown(host, container);
    });

    test("attachGizmo while a gizmo is already attached replaces it without an explicit detach (RH-019)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "translate");
      expect(() => host.attachGizmo(FIXTURE_DECOY_NODE_INDEX, "rotate")).not.toThrow();
      expect(() => host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "scale")).not.toThrow();
      teardown(host, container);
    });

    test("detachGizmo removes any attached gizmo and is a no-op when none is attached (RH-025)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(() => host.detachGizmo()).not.toThrow(); // no gizmo attached yet
      host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "translate");
      expect(() => host.detachGizmo()).not.toThrow();
      expect(() => host.detachGizmo()).not.toThrow(); // idempotent
      teardown(host, container);
    });

    test(
      'attachGizmo + onGizmoChange emits phase "drag" while dragging and phase "commit" exactly once on release (RH-003)',
      async () => {
        const { host, container } = await mountedHost(makeHost);
        await loadFixture(host);
        host.setCameraPose(DIAGONAL_CAMERA_POSE);
        host.attachGizmo(FIXTURE_HIT_NODE_INDEX, "translate");

        const canvas = container.querySelector("canvas");
        expect(canvas).not.toBeNull();
        const rect = canvas!.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const { lookAtBasis } = await import("./internal/vec-math.js");
        const cameraBasis = lookAtBasis(DIAGONAL_CAMERA_POSITION, DIAGONAL_CAMERA_TARGET);

        const axisDirections: Vec3[] = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ];
        const radii = [18, 30, 45, 65, 90];

        let dragCount = 0;
        let commitCount = 0;
        const unsubscribe = host.onGizmoChange((event) => {
          if (event.phase === "drag") dragCount++;
          if (event.phase === "commit") commitCount++;
        });

        let found = false;
        for (const axis of axisDirections) {
          if (found) break;
          const screenDir = worldDirectionToScreen(axis, cameraBasis);
          const dirLen = Math.hypot(screenDir.dx, screenDir.dy) || 1;
          const ux = screenDir.dx / dirLen;
          const uy = screenDir.dy / dirLen;
          for (const sign of [1, -1]) {
            if (found) break;
            for (const radius of radii) {
              const x = centerX + ux * radius * sign;
              const y = centerY + uy * radius * sign;
              dragCount = 0;
              commitCount = 0;
              await dispatchMouseGesture([
                { type: "mousePressed", x, y },
                { type: "mouseMoved", x: x + 6, y: y + 4 },
                { type: "mouseMoved", x: x + 12, y: y + 8 },
                { type: "mouseReleased", x: x + 12, y: y + 8 }
              ]);
              if (dragCount > 0 && commitCount === 1) {
                found = true;
                break;
              }
            }
          }
        }

        expect(found).toBe(true);
        expect(dragCount).toBeGreaterThan(0);
        expect(commitCount).toBe(1);
        unsubscribe();
        teardown(host, container);
      },
      20000
    );

    test("applyPointer writes the given pointer/value without requiring a reload (RH-020)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setCameraPose(FRONT_CAMERA_POSE);
      expect(() => host.applyPointer("/nodes/0/translation", [5, 0, 0])).not.toThrow();
      // Node 0 moved off-center — the same NDC center pick should now miss it.
      expect(host.pick(0, 0)?.nodeIndex).not.toBe(FIXTURE_HIT_NODE_INDEX);
      teardown(host, container);
    });

    test("applyPointer does not create a HistoryStack entry (RH-021)", async () => {
      // RenderHost has no notion of HistoryStack at all (engine-api keeps
      // that concept entirely in editor-core) — applyPointer's contract is
      // satisfied by construction: there is nothing here that could create
      // one. This test asserts the one observable half of that: repeated
      // applyPointer calls are just live writes, not additive/undoable
      // history entries — i.e. calling it many times behaves the same as
      // calling it once with the final value (no accumulated log).
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      for (let i = 0; i < 5; i++) {
        host.applyPointer("/nodes/0/translation", [i, 0, 0]);
      }
      host.setCameraPose(FRONT_CAMERA_POSE);
      // Final write wins; nothing about a five-call history is observable.
      expect(() => host.applyPointer("/nodes/0/translation", [0, 0, 0])).not.toThrow();
      teardown(host, container);
    });

    test("setHighlight(indices) highlights exactly the given node indices (RH-022)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(() => host.setHighlight([FIXTURE_HIT_NODE_INDEX])).not.toThrow();
      expect(() => host.setHighlight([FIXTURE_HIT_NODE_INDEX, FIXTURE_DECOY_NODE_INDEX])).not.toThrow();
      teardown(host, container);
    });

    test("setHighlight([]) clears all highlighting (RH-023)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setHighlight([FIXTURE_HIT_NODE_INDEX]);
      expect(() => host.setHighlight([])).not.toThrow();
      teardown(host, container);
    });

    test("setReferenceHighlight(indices) highlights exactly the given node indices, independent of setHighlight's own set (RH-029)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setHighlight([FIXTURE_HIT_NODE_INDEX]);
      expect(() => host.setReferenceHighlight([FIXTURE_DECOY_NODE_INDEX])).not.toThrow();
      // Both tiers coexist — clearing one must not be required by, or
      // implied by, setting the other.
      expect(() => host.setHighlight([])).not.toThrow();
      expect(() => host.setReferenceHighlight([FIXTURE_HIT_NODE_INDEX, FIXTURE_DECOY_NODE_INDEX])).not.toThrow();
      teardown(host, container);
    });

    test("setReferenceHighlight([]) clears reference highlighting without touching setHighlight's set (RH-030)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setHighlight([FIXTURE_HIT_NODE_INDEX]);
      host.setReferenceHighlight([FIXTURE_DECOY_NODE_INDEX]);
      expect(() => host.setReferenceHighlight([])).not.toThrow();
      // The plain selection set is untouched by the reference-highlight
      // clear — re-clearing it is still just as valid a no-op-shaped call.
      expect(() => host.setHighlight([FIXTURE_HIT_NODE_INDEX])).not.toThrow();
      teardown(host, container);
    });

    test("snapshot() after loadScene resolves to a PNG Blob at the canvas's current resolution (RH-024)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      const blob = await host.snapshot();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe("image/png");
      teardown(host, container);
    });

    // Full punctual-light control (specs/render-host.md RH-032/RH-033): the
    // shared editor-overlay seam. This fixture has no light node at all —
    // deliberately so, since the portable cross-implementation contract can
    // only assert the "never throws" half; the REAL per-kind rendering
    // behavior (a light node actually growing a PointLightHelper/etc, RH-034's
    // snapshot exclusion) is engine-three's own implementation-specific
    // coverage (packages/engine-three/test/render-host.light-helpers.test.ts),
    // not assertable against an arbitrary future RenderHost implementation.
    test("setEditorHelpers(descriptors) does not throw, including for an unknown kind or an unresolvable nodeIndex (RH-032)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      expect(() => host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_HIT_NODE_INDEX }])).not.toThrow(); // a real node, but not a light — resolves to "skip, don't throw".
      expect(() => host.setEditorHelpers([{ kind: "audio-emitter", nodeIndex: FIXTURE_HIT_NODE_INDEX }])).not.toThrow(); // unknown kind.
      expect(() => host.setEditorHelpers([{ kind: "light", nodeIndex: 999 }])).not.toThrow(); // unresolvable nodeIndex.
      teardown(host, container);
    });

    test("setEditorHelpers([]) clears any previously-set helpers without throwing (RH-033)", async () => {
      const { host, container } = await mountedHost(makeHost);
      await loadFixture(host);
      host.setEditorHelpers([{ kind: "light", nodeIndex: FIXTURE_HIT_NODE_INDEX }]);
      expect(() => host.setEditorHelpers([])).not.toThrow();
      teardown(host, container);
    });
  });
}
