import { test, expect, type Page } from "@playwright/test";
import { ACTIVE_CAMERA_FIXTURE_NAME, buildActiveCameraFixtureBytes } from "./active-camera-fixture.js";

/**
 * PC-011 / RH-036: the KHR_interactivity activeCamera pointers read the
 * camera that is actually rendering in the viewport. The fixture graph copies
 * `activeCamera/position` and `activeCamera/perspective/yfov` into overlay
 * variables on every tick; the assertions read the on-screen "Variables
 * (live)" overlay (not the API), then orbit the camera and require the shown
 * position to follow.
 */

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: ACTIVE_CAMERA_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildActiveCameraFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("active-camera-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

function parseVec(text: string | null): number[] {
  return (text ?? "").replace(/[[\]\s]/g, "").split(",").map(Number);
}

/** Polls the on-screen camPos until it is within 1e-3 of `expected` (the orbit camera re-derives orientation from its target, so exact equality is float-noisy). */
async function expectCamPos(page: Page, expected: number[]): Promise<void> {
  await expect
    .poll(async () => {
      const v = parseVec(await overlayVal(page, "camPos"));
      return Math.max(...v.map((x, i) => Math.abs(x - expected[i]!)));
    })
    .toBeLessThan(1e-3);
}

async function overlayVal(page: Page, key: string): Promise<string | null> {
  return page.getByTestId(`viewport.play-overlay.variable.${key}`).locator(".val").textContent();
}

for (const engine of ["interpreter", "compiled"] as const) {
  test(`activeCamera pointers show the viewport camera in play (${engine})`, async ({ page }) => {
    await importFixture(page);
    await page.evaluate(() =>
      window.__gltfStudioTest!.setCameraPose({ position: [0, 0, 3], rotation: [0, 0, 0, 1], target: [0, 0, 0] })
    );
    if (engine === "compiled") await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();

    // Not NaN any more: the engine was given the camera. Position matches the pose we pinned.
    await expectCamPos(page, [0, 0, 3]);
    // yfov is radians (three's 45deg vertical fov = 0.7854).
    await expect.poll(async () => Number(await overlayVal(page, "camYfov"))).toBeCloseTo(Math.PI / 4, 3);

    if (engine === "compiled") {
      // Documented limitation (PC-011): the compiled engine only gets a construction-time snapshot.
      const before = parseVec(await overlayVal(page, "camPos"));
      await page.evaluate(() =>
        window.__gltfStudioTest!.setCameraPose({ position: [4, 1, 2], rotation: [0, 0, 0, 1], target: [0, 0, 0] })
      );
      await page.waitForTimeout(300);
      expect(parseVec(await overlayVal(page, "camPos"))).toEqual(before);
      return;
    }

    // Interpreter: moving the camera (programmatically, then by a REAL mouse orbit drag) changes the value on screen.
    await page.evaluate(() =>
      window.__gltfStudioTest!.setCameraPose({ position: [4, 1, 2], rotation: [0, 0, 0, 1], target: [0, 0, 0] })
    );
    await expectCamPos(page, [4, 1, 2]);

    const settled = parseVec(await overlayVal(page, "camPos"));
    const box = (await page.getByTestId("viewport.mount").boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 30, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const now = parseVec(await overlayVal(page, "camPos"));
        return Math.hypot(now[0]! - settled[0]!, now[1]! - settled[1]!, now[2]! - settled[2]!);
      })
      .toBeGreaterThan(0.1);
  });
}
