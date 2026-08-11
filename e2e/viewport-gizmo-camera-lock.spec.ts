import { test, expect, type Page } from "@playwright/test";
import type { CameraPose } from "@gltf-studio/engine-api";
import { FIXTURE_GLB_PATH, FIXTURE_FRONT_CAMERA_POSE } from "./global-setup.js";

/**
 * Regression coverage for "moving the gizmo also rotates the camera"
 * (specs/ux-viewport.md UX-305, specs/render-host.md RH-003): a bug PR #21's
 * own click-vs-drag threshold fix introduced. That fix (Viewport.tsx's
 * `pointerDownPos`/`thresholdCrossed`) disables OrbitControls on
 * `pointerdown` and re-enables it the instant a gesture's cumulative
 * movement crosses `CLICK_DRAG_THRESHOLD_PX` (5px) — with no regard for
 * WHETHER a TransformControls gizmo owns that gesture. A real gizmo drag
 * moves the mouse well past 5px almost immediately, so it re-armed
 * OrbitControls out from under TransformControls' own
 * `dragging-changed`-driven disable (render-host.ts's `attachGizmo`),
 * leaving BOTH the dragged object and the orbiting camera moving together
 * for the rest of the gesture.
 *
 * Fixed by `ThreeRenderHost.isGizmoDragging()` (backed directly by
 * TransformControls' own public `dragging` flag) gating that re-enable in
 * Viewport.tsx's `onPointerMove`.
 *
 * This needs a REAL, OS-level mouse drag landing on one of the gizmo's own
 * screen-space handles — `window.__gltfStudioTest.simulateGizmoDrag` (used
 * by e2e/viewport.spec.ts's own gizmo/history coverage) writes the object's
 * transform and re-fires TransformControls' internal events directly,
 * WITHOUT going through any real pointer input at all, so it cannot
 * exercise Viewport's pointer handlers and would never have caught this bug
 * in the first place. Playwright's `page.mouse` API dispatches through the
 * same real CDP `Input.dispatchMouseEvent` path as
 * e2e/viewport-real-click.spec.ts's own regression coverage, which is what's
 * needed here too.
 *
 * Locating the handle adapts the search technique from
 * packages/contract-tests/src/render-host.ts's own real-pointer gizmo test
 * (RH-003): with a known, diagonal camera pose (all three world axes
 * visible/distinguishable on screen) and the object at the world origin, a
 * world-space axis direction projects to a screen-space direction via the
 * camera's own look-at basis (ignoring perspective foreshortening — good
 * enough for picking a *search direction*, not an exact pixel distance);
 * candidates are then swept outward from the object's screen position along
 * that direction, on both signs of all three axes (matching the actual
 * gizmo geometry — TransformControls' translate handles extend both ways
 * through the object, see its own `gizmoTranslate` axis definitions).
 *
 * UNLIKE the contract-tests version, the search itself never drives a real
 * mouse gesture: it uses `hitTestGizmoHandle` (a thin e2e-only wrapper
 * around TransformControls' own public, side-effect-free `pointerHover`) to
 * find the exact handle position with zero real pointer input. This matters
 * specifically because a missed *real* trial-and-error drag would be a
 * genuine OrbitControls orbit, and OrbitControls' own `enableDamping` means
 * its rotation momentum outlives the gesture, decaying gradually over many
 * subsequent frames regardless of `controls.enabled` — silently polluting
 * the very camera-pose comparison this test exists to make. Only ONE real
 * `page.mouse` gesture ever runs: the drag actually being asserted on.
 */

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function lookAtBasis(position: Vec3, target: Vec3, worldUp: Vec3 = [0, 1, 0]): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalize3(subtract3(position, target));
  let right = cross3(worldUp, forward);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize3(right);
  const up = cross3(forward, right);
  return { forward, right, up };
}
function lookAtQuaternion(position: Vec3, target: Vec3, worldUp: Vec3 = [0, 1, 0]): Quat {
  const { forward, right, up } = lookAtBasis(position, target, worldUp);
  const [m00, m10, m20] = right;
  const [m01, m11, m21] = up;
  const [m02, m12, m22] = [-forward[0], -forward[1], -forward[2]];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
function worldDirectionToScreen(worldDir: Vec3, basis: { right: Vec3; up: Vec3 }): { dx: number; dy: number } {
  return { dx: dot3(worldDir, basis.right), dy: -dot3(worldDir, basis.up) };
}

/** Node 1 ("Widget") sits at the world origin (see global-setup.ts) — this diagonal pose keeps it centered on screen while exposing all three gizmo axes distinctly. */
const DIAGONAL_CAMERA_POSITION: Vec3 = [2.4, 2, 2.6];
const DIAGONAL_CAMERA_TARGET: Vec3 = [0, 0, 0];
const DIAGONAL_CAMERA_POSE: CameraPose = {
  position: DIAGONAL_CAMERA_POSITION,
  rotation: lookAtQuaternion(DIAGONAL_CAMERA_POSITION, DIAGONAL_CAMERA_TARGET),
  target: DIAGONAL_CAMERA_TARGET
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

async function setCameraPose(page: Page, pose: CameraPose): Promise<void> {
  await page.evaluate((p) => window.__gltfStudioTest!.setCameraPose(p), pose);
}

async function getCameraPose(page: Page) {
  return page.evaluate(() => window.__gltfStudioTest!.getCameraPose());
}

/** NDC hit-test at (ndcX, ndcY) — see `hitTestGizmoHandle`'s own doc comment (render-host.ts) for why this has no side effect on OrbitControls. */
async function hitTestGizmoHandle(page: Page, ndcX: number, ndcY: number): Promise<string | null> {
  return page.evaluate(([x, y]) => window.__gltfStudioTest!.hitTestGizmoHandle(x, y), [ndcX, ndcY] as const);
}

test.describe("viewport gizmo drag does not move the camera (regression)", () => {
  test("a real drag on a gizmo handle keeps the camera pose IDENTICAL, moves the object, and pushes exactly one history commit", async ({
    page
  }) => {
    await importFixture(page);

    // Select "Widget" (node 1) under the known-good front pose, exactly like e2e/viewport.spec.ts.
    await setCameraPose(page, FIXTURE_FRONT_CAMERA_POSE);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("viewport.selection-label")).toContainText("Widget");
    await expect(page.getByTestId("viewport.gizmo-w")).toHaveClass(/active/); // translate is the default mode
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");

    // Now switch to a diagonal pose (still centered on the object, since it sits at the world origin) so all three gizmo axes are distinguishable on screen.
    await setCameraPose(page, DIAGONAL_CAMERA_POSE);
    const cameraBasis = lookAtBasis(DIAGONAL_CAMERA_POSITION, DIAGONAL_CAMERA_TARGET);
    const radiusFractions = [0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.37, 0.45, 0.55, 0.65, 0.78, 0.9];
    const axisDirections: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];

    // Phase 1 (no real pointer input at all): find an NDC point that
    // actually hits the attached gizmo's picker geometry.
    let hitNdc: { x: number; y: number; axis: string } | null = null;
    outer: for (const axisVec of axisDirections) {
      const screenDir = worldDirectionToScreen(axisVec, cameraBasis);
      const dirLen = Math.hypot(screenDir.dx, screenDir.dy) || 1;
      const ux = screenDir.dx / dirLen;
      const uy = screenDir.dy / dirLen;
      for (const sign of [1, -1]) {
        for (const fraction of radiusFractions) {
          const ndcX = ux * fraction * sign;
          const ndcY = uy * fraction * sign;
          if (Math.abs(ndcX) > 0.95 || Math.abs(ndcY) > 0.95) continue;
          const axis = await hitTestGizmoHandle(page, ndcX, ndcY);
          if (axis) {
            hitNdc = { x: ndcX, y: ndcY, axis };
            break outer;
          }
        }
      }
    }
    expect(hitNdc, "expected the NDC search to find a real gizmo handle").not.toBeNull();

    // Convert the found NDC point to a real screen position for the one real gesture this test performs.
    const screenX = box.x + ((hitNdc!.x + 1) / 2) * box.width;
    const screenY = box.y + ((1 - hitNdc!.y) / 2) * box.height;

    const poseBeforeDrag = await getCameraPose(page);

    // Phase 2: the ONE real, OS-level mouse drag this test performs, landing exactly on the handle `hitTestGizmoHandle` found.
    await page.mouse.move(screenX, screenY);
    await page.mouse.down();
    await page.mouse.move(screenX + 10, screenY + 7, { steps: 4 });
    await page.mouse.move(screenX + 22, screenY + 15, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200); // let the rAF loop's controls.update()/damping settle before sampling the pose.

    // The core regression assertion: the camera did not move AT ALL during a real gizmo drag.
    const poseAfterDrag = await getCameraPose(page);
    expect(poseAfterDrag, `a real drag on gizmo axis "${hitNdc!.axis}" must not move the camera`).toEqual(poseBeforeDrag);

    // The object DID move (a real SceneEdit.setTransform reached the document) — the actual drag committed.
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    const [px, py, pz] = await Promise.all([
      page.getByTestId("inspector.transform.position-x").inputValue(),
      page.getByTestId("inspector.transform.position-y").inputValue(),
      page.getByTestId("inspector.transform.position-z").inputValue()
    ]);
    expect(px !== "0" || py !== "0" || pz !== "0", "the dragged object's position must have changed").toBe(true);

    // Exactly one history commit for the whole gesture (RH-003), not one per objectChange tick.
    await page.getByTestId("topbar.history-toggle").click();
    await expect(page.getByTestId("topbar.history-dropdown").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("topbar.history-dropdown.entry.0")).toHaveClass(/current/);
  });
});
