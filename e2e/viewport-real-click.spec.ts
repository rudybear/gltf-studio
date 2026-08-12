import { PNG } from "pngjs";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { multiFileFixtureComplete } from "./multi-file-fixture.js";

/**
 * specs/ux-viewport.md UX-302/UX-303/UX-301: real-mouse-input coverage for
 * viewport click-to-select, empty-click deselect, and hover, WITHOUT
 * `window.__gltfStudioTest.setCameraPose` — the DEFAULT post-import camera
 * (`frameCameraOnObject`, engine-three's own auto-frame), on BOTH the
 * single-file and packed-multi-file import paths.
 *
 * Why this file exists (drift note, see specs/ux-viewport.md and this
 * task's own bug report): e2e/viewport.spec.ts's click/hover coverage is
 * real in every way EXCEPT the camera — it drives genuine CDP mouse events
 * at genuine screen coordinates, but always after calling `setCameraPose`
 * to a fixed, hand-picked pose so a center-of-canvas click deterministically
 * lands on "Widget". That was a reasonable determinism choice for THAT
 * suite's purpose (isolating gizmo/undo/frame coverage from camera-framing
 * behavior) but it meant no e2e test ever exercised the actual DEFAULT
 * camera a real user always sees on import — which is exactly where a real
 * bug lived: `frameCameraOnObject` frames the WHOLE SCENE (every node's
 * combined bounding box), so for a scene with more than one spread-out
 * object (this fixture's decoy "Widget_Detail" node, or any real multi-part
 * asset), the geometric center of that combined box often lands in empty
 * space between objects — a blind "click dead center" test would have
 * reported a false failure there even on correct code, so this file instead
 * finds where the object ACTUALLY rendered (real screenshot pixels, the
 * same information a sighted user acts on) and clicks/hovers there.
 *
 * The real bug this uncovered (see `pointerdown`->`pointerup` jitter test
 * below) was OrbitControls having no click-vs-drag threshold of its own: it
 * starts rotating the camera on the very first `pointermove` after
 * `pointerdown`, however small. `page.mouse.click()` moves to the target
 * and presses/releases with ZERO intervening movement, so no test using it
 * alone — including every test in viewport.spec.ts — could ever have caught
 * this; a real mouse/trackpad essentially never holds pixel-perfect still
 * between press and release. Fixed in Viewport.tsx (`pointerDownPos` /
 * `setControlsEnabled`).
 */

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

async function importMultiFileFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureComplete());
  await expect(page.getByTestId("topbar.project-name")).toBeVisible();
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

type Point = { x: number; y: number };

/**
 * Screenshots `mount` (the real `<canvas>`'s host, whatever the DEFAULT
 * camera happens to be showing) and clusters "reddish" pixels — every mesh
 * fixture in this suite that needs to be pick-tested renders with a
 * `baseColorFactor` red material (global-setup.ts's `WidgetMaterial`), a hue
 * check (`r` well above both `g` and `b`) that cleanly excludes
 * ThreeRenderHost's always-on `GridHelper` (light gray, r≈g≈b) and its dark
 * `0x11141a` background (also r≈g≈b). Clusters are split on a y-axis gap so
 * two disjoint objects (e.g. this fixture's "Widget" + decoy
 * "Widget_Detail") don't get averaged into one bogus centroid landing in
 * the empty space between them — the exact failure mode a blind
 * canvas-center click has under the default whole-scene camera frame.
 * Returned points are in ABSOLUTE page coordinates, ready for
 * `page.mouse.click`/`page.mouse.move`, sorted by cluster size descending.
 */
async function reddishClusters(mount: Locator): Promise<Point[]> {
  const box = (await mount.boundingBox())!;
  const buffer = await mount.screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 55 && r > g * 1.15 && r > b * 1.15) {
        points.push({ x, y });
      }
    }
  }
  expect(points.length, "expected at least some reddish (WidgetMaterial) pixels in the rendered canvas").toBeGreaterThan(0);
  points.sort((a, b) => a.y - b.y);
  const clusters: Array<{ x: number; y: number }[]> = [];
  let current: Array<{ x: number; y: number }> = [points[0]];
  for (let k = 1; k < points.length; k++) {
    if (points[k].y - points[k - 1].y > 15) {
      clusters.push(current);
      current = [];
    }
    current.push(points[k]);
  }
  clusters.push(current);
  return clusters
    .map((cluster) => ({
      x: box.x + cluster.reduce((s, p) => s + p.x, 0) / cluster.length,
      y: box.y + cluster.reduce((s, p) => s + p.y, 0) / cluster.length,
      n: cluster.length
    }))
    .sort((a, b) => b.n - a.n)
    .map(({ x, y }) => ({ x, y }));
}

/** A corner of the mount, provably clear of any object under EITHER fixture's default camera (both keep their geometry well clear of the frame edges). */
async function emptyCorner(mount: Locator): Promise<Point> {
  const box = (await mount.boundingBox())!;
  return { x: box.x + 4, y: box.y + 4 };
}

test.describe("viewport real-mouse click/hover, DEFAULT camera, no setCameraPose hook (UX-301/302/303)", () => {
  test("simple-scene.glb: a real click on the actually-rendered object selects it; a real click on empty canvas deselects", async ({
    page
  }) => {
    await importFixture(page);
    const mount = page.getByTestId("viewport.mount");
    const [biggest] = await reddishClusters(mount);

    await page.mouse.click(biggest.x, biggest.y);
    await expect(page.getByTestId("viewport.selection-label")).toBeVisible();
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();

    const empty = await emptyCorner(mount);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId("viewport.selection-label")).toHaveCount(0);
    await expect(page.getByTestId("inspector.empty")).toBeVisible();
  });

  test("packed multi-file .gltf import: a real click on the actually-rendered object selects it; a real click on empty canvas deselects", async ({
    page
  }) => {
    await importMultiFileFixture(page);
    const mount = page.getByTestId("viewport.mount");
    // Unlike simple-scene.glb (two spread-out nodes), this fixture's
    // "Widget" is the ONLY mesh in the scene (multi-file-fixture.ts's own
    // header comment: it carries no `material`, so it can't be found via
    // `reddishClusters`'s hue check either) — `frameCameraOnObject`'s
    // `lookAt(center)` on a single-object whole-scene bounding box always
    // projects that object's center to NDC (0,0), i.e. dead center of the
    // canvas, so a center click is a real, deterministic click on the
    // rendered object here, not the blind guess it would be for a
    // multi-object scene (see this file's header comment on why that guess
    // fails for simple-scene.glb).
    const box = (await mount.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.click(center.x, center.y);
    await expect(page.getByTestId("viewport.selection-label")).toBeVisible();
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();

    const empty = await emptyCorner(mount);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId("viewport.selection-label")).toHaveCount(0);
    await expect(page.getByTestId("inspector.empty")).toBeVisible();
  });

  test("hovering the actually-rendered object shows the hover affordance; moving off it clears the hover (UX-301)", async ({ page }) => {
    await importFixture(page);
    const mount = page.getByTestId("viewport.mount");
    const [biggest] = await reddishClusters(mount);
    const empty = await emptyCorner(mount);

    await page.mouse.move(empty.x, empty.y);
    await expect(mount).not.toHaveClass(/hover-pickable/);

    await page.mouse.move(biggest.x, biggest.y);
    await expect(mount).toHaveClass(/hover-pickable/);

    await page.mouse.move(empty.x, empty.y);
    await expect(mount).not.toHaveClass(/hover-pickable/);
  });

  /**
   * The actual root-cause regression test: a real mouse/trackpad essentially
   * never holds pixel-perfect still between press and release. Before the
   * fix, OrbitControls (no click-vs-drag threshold of its own) rotated the
   * camera on every intervening `pointermove` — including these few pixels
   * of incidental jitter — desyncing the pick ray from the pixel the object
   * was actually rendered at. `page.mouse.click()` alone (used everywhere
   * else in this suite, including viewport.spec.ts) cannot exercise this at
   * all: it presses and releases with zero movement.
   */
  test("a real click with a few pixels of incidental jitter between press and release still selects the object, and does not rotate the camera (regression)", async ({
    page
  }) => {
    await importFixture(page);
    const mount = page.getByTestId("viewport.mount");
    const [target] = await reddishClusters(mount);

    const poseBefore = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    // A few pixels of incidental hand jitter -- well within what any real
    // mouse or trackpad produces on a "still" click, and well under the
    // fix's 5px click/drag threshold.
    await page.mouse.move(target.x + 2, target.y + 1, { steps: 2 });
    await page.mouse.move(target.x + 4, target.y - 2, { steps: 2 });
    await page.mouse.move(target.x + 1, target.y - 1, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(200); // let the rAF loop's controls.update()/damping settle before sampling the pose.

    const poseAfter = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());
    expect(poseAfter, "a click's incidental jitter must not rotate the camera").toEqual(poseBefore);

    await expect(page.getByTestId("viewport.selection-label")).toBeVisible();
    await expect(page.getByTestId("inspector.transform.section")).toBeVisible();
  });

  /**
   * The other half of the same fix: a REAL, deliberate orbit drag must
   * still work, and must not also change the selection at its drop point.
   * Dragged from `emptyCorner`, deliberately NOT from `target` — selecting
   * "target" first attaches a real TransformControls gizmo right at the
   * object's own screen position (RH-018), and a drag starting on one of
   * ITS handles is a gizmo drag, not an orbit (attachGizmo's own
   * "dragging-changed" listener explicitly disables OrbitControls for
   * that). Starting from the empty corner keeps this a clean test of
   * orbiting past an EXISTING selection without disturbing it.
   */
  test("a real deliberate drag still orbits the camera, and does not change the selection at the drop point", async ({ page }) => {
    await importFixture(page);
    const mount = page.getByTestId("viewport.mount");
    const [target] = await reddishClusters(mount);
    const empty = await emptyCorner(mount);

    await page.mouse.click(target.x, target.y);
    await expect(page.getByTestId("viewport.selection-label")).toBeVisible();
    const selectionBefore = await page.getByTestId("viewport.selection-label").textContent();
    const poseBefore = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());

    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 120, empty.y + 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200); // let the rAF loop's controls.update()/damping settle before sampling the pose.

    const poseAfter = await page.evaluate(() => window.__gltfStudioTest!.getCameraPose());
    expect(poseAfter, "a deliberate drag must still orbit the camera").not.toEqual(poseBefore);
    await expect(page.getByTestId("viewport.selection-label")).toHaveText(selectionBefore ?? "");
  });
});
