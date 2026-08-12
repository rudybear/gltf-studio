import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH, FIXTURE_FRONT_CAMERA_POSE } from "./global-setup.js";

/**
 * M2 viewport integration: the real engine-three RenderHost mounted into
 * `#viewport-mount` (specs/ux-viewport.md UX-3xx, specs/render-host.md
 * RH-###), selection sync (UX-302/UX-303), the W/E/R gizmo (UX-304..306,
 * RH-003/018/019/025), and the resulting Undo/Redo history (DOC-011..015,
 * DOC-039, DOC-040).
 *
 * Camera determinism: `window.__gltfStudioTest` (installed by Viewport.tsx
 * alongside the RenderHost's own mount, torn down with it) exposes
 * `setCameraPose`/`getCameraPose` so a center-of-canvas click reliably hits
 * the fixture's "Widget" mesh (node 1) — see global-setup.ts's
 * FIXTURE_FRONT_CAMERA_POSE and its node-3 "Widget_Detail" placement, which
 * mirrors packages/contract-tests/src/render-host.ts's Hit/Decoy pattern.
 *
 * Gizmo drag: driven via `window.__gltfStudioTest.simulateGizmoDrag`
 * (backed by ThreeRenderHost.simulateGizmoDrag — see specs/render-host.md's
 * M2 DECISION note), not a pixel-accurate Playwright mouse drag onto
 * TransformControls' 3D screen-space handles. That would need reproducing
 * packages/engine-three's own axis/radius search loop (internal/vec-math.ts)
 * against a headless-Chromium/CI-stable projection, which is fragile for
 * comparatively little extra coverage: `simulateGizmoDrag` still exercises
 * every bit of REAL application logic downstream of a drag (TransformControls'
 * own "objectChange"/"dragging-changed" events, ThreeRenderHost.onGizmoChange,
 * Viewport's commit handler, SceneEdit.setTransform, HistoryStack) — only the
 * physical pointer input is synthesized, exactly the situation this task's
 * brief called out as the case for the "invoke through the test hook" choice
 * over CDP mouse dispatch.
 */

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

/**
 * Waits for the async `loadScene` (real GLTFLoader parse + three-adapter
 * index-table build) to finish, then sets the deterministic front pose.
 * Without the `isReady()` wait, a click/hover/frame issued right after
 * import can race the load — `pick()`/`frameNode` silently no-op against an
 * empty scene rather than fail loudly, which would otherwise show up here
 * as a flaky "selection didn't happen" failure instead of its real cause.
 */
async function setFrontCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((pose) => window.__gltfStudioTest!.setCameraPose(pose), FIXTURE_FRONT_CAMERA_POSE);
}

/** UX-300: a real rendered scene has more than one distinct pixel color (background + lit geometry + grid), unlike a blank/placeholder canvas. */
async function canvasHasVariedPixels(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector("#viewport-mount canvas") as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const [r0, g0, b0] = [data[0], data[1], data[2]];
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return true;
    }
    return false;
  });
}

test.describe("viewport (UX-3xx)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("the real RenderHost canvas mounts and renders non-blank content (UX-300)", async ({ page }) => {
    await expect(page.locator("#viewport-mount canvas")).toBeVisible();
    await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
    expect(await canvasHasVariedPixels(page)).toBe(true);
  });

  test("clicking a rendered object selects it (synced to the scene tree + Inspector); clicking empty space clears it (UX-302/UX-303)", async ({
    page
  }) => {
    await setFrontCamera(page);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;

    // Center of the canvas = NDC (0,0) = dead center of the "Widget" triangle under FIXTURE_FRONT_CAMERA_POSE.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("scene-tree.row.1")).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
    await expect(page.getByTestId("viewport.selection-label")).toContainText("Widget");

    // A corner of the canvas has nothing under it (the triangle spans roughly the center third).
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect(page.getByTestId("scene-tree.row.1")).not.toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.empty")).toBeVisible();
    await expect(page.getByTestId("viewport.selection-label")).toHaveCount(0);
  });

  test("hovering a rendered object shows a hover affordance distinct from the click-to-select highlight, cleared off-object (UX-301)", async ({
    page
  }) => {
    await setFrontCamera(page);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const corner = { x: box.x + 4, y: box.y + 4 };

    await page.mouse.move(corner.x, corner.y);
    await expect(mount).not.toHaveClass(/hover-pickable/);

    await page.mouse.move(center.x, center.y);
    await expect(mount).toHaveClass(/hover-pickable/); // ThreeRenderHost.setHover engaged + pointer cursor
    await expect(page.getByTestId("scene-tree.row.1")).not.toHaveClass(/selected/); // hover alone never selects

    await page.mouse.move(corner.x, corner.y);
    await expect(mount).not.toHaveClass(/hover-pickable/); // moving off-object clears the hover outline
  });

  test("W/E/R toolbar buttons are exactly three, mutually exclusive gizmo modes; switching modes/selection replaces the gizmo in place (UX-304/UX-306)", async ({
    page
  }) => {
    await setFrontCamera(page);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // select "Widget"

    await expect(page.getByTestId("viewport.gizmo-group").locator("button")).toHaveCount(3);
    await expect(page.getByTestId("viewport.gizmo-w")).toHaveClass(/active/); // translate is the default mode

    // UX-306: switching mode while a gizmo is already attached replaces it in place — no errors, no visible detach step.
    await page.getByTestId("viewport.gizmo-e").click();
    await expect(page.getByTestId("viewport.gizmo-e")).toHaveClass(/active/);
    await expect(page.getByTestId("viewport.gizmo-w")).not.toHaveClass(/active/);

    await page.getByTestId("viewport.gizmo-r").click();
    await expect(page.getByTestId("viewport.gizmo-r")).toHaveClass(/active/);
    await expect(page.getByTestId("viewport.gizmo-e")).not.toHaveClass(/active/);

    // "W" keyboard shortcut mirrors the toolbar button's own tooltip.
    await page.keyboard.press("w");
    await expect(page.getByTestId("viewport.gizmo-w")).toHaveClass(/active/);
  });

  test("the viewport keeps rendering (no error, still non-blank) after a bottom-dock resize (UX-307)", async ({ page }) => {
    await setFrontCamera(page);
    const handle = page.getByTestId("dock.resize-handle");
    const handleBox = (await handle.boundingBox())!;

    await page.mouse.move(handleBox.x + 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 2, handleBox.y - 80, { steps: 5 }); // grow the viewport
    await page.mouse.up();

    // ThreeRenderHost's own ResizeObserver (RH's mount contract) re-sizes the
    // canvas/camera — the gizmo/highlight/hover, being real 3D geometry
    // rather than a manually-repositioned DOM overlay, never need their own
    // resize-recompute step to stay lined up with the model (UX-307). Give
    // the ResizeObserver + next rAF render a moment to actually run before
    // sampling pixels — both fire asynchronously after the mouseup.
    await expect(page.locator("#viewport-mount canvas")).toBeVisible();
    await page.waitForTimeout(200);
    expect(await canvasHasVariedPixels(page)).toBe(true);
  });

  test("a committed gizmo drag pushes exactly one undoable SceneEdit.setTransform, listed in the real History dropdown; Undo restores it, Redo reapplies it (UX-108, UX-305, DOC-011..015, DOC-039, DOC-040)", async ({
    page
  }) => {
    await setFrontCamera(page);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // select "Widget" (node 1), attaches the translate gizmo

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");

    const committed = await page.evaluate(() => window.__gltfStudioTest!.simulateGizmoDrag([1, 0, 0]));
    expect(committed).toBe(true);

    // Exactly one history entry, marked current (DOC-039), and Undo is now live.
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("1");
    await page.getByTestId("topbar.history-toggle").click();
    await expect(page.getByTestId("topbar.history-dropdown").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("topbar.history-dropdown.entry.0")).toHaveClass(/current/);
    await page.getByTestId("topbar.history-toggle").click(); // close it back up

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("topbar.redo")).toBeEnabled();

    await page.getByTestId("topbar.redo").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("1");
    await expect(page.getByTestId("topbar.redo")).toBeDisabled();
  });

  test("Frame selected reframes the camera around the selection, and around the whole scene when nothing is selected (UX-308)", async ({
    page
  }) => {
    await setFrontCamera(page);
    const before = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());

    // Nothing selected: frames the whole scene.
    await page.getByTestId("viewport.camera-frame").click();
    const afterWholeScene = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());
    expect(afterWholeScene.position).not.toEqual(before.position);

    // With "Widget" selected: frames just that node (a different bounding box/camera distance).
    // Reset to the known front pose FIRST so the selection click's NDC math is still valid — the
    // whole-scene frame above moved the camera away from it.
    await setFrontCamera(page);
    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId("viewport.camera-frame").click();
    const afterSelection = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());
    expect(afterSelection.position).not.toEqual(FIXTURE_FRONT_CAMERA_POSE.position);
  });
});
