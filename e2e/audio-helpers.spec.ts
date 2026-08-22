import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { AUDIO_HELPERS_EMITTER_NODE_INDEX, AUDIO_HELPERS_FIXTURE_NAME, AUDIO_HELPERS_ZONE_NODE_INDEX, buildAudioHelpersFixtureBytes } from "./audio-helpers-fixture.js";

/**
 * Audio viewport helpers (specs/render-host.md RH-035, specs/ux-viewport.md
 * UX-314): the range/cone shape helper for a positional cone emitter, the
 * translucent volume helper for a KHR_audio_environment zone, the shared
 * "Helpers" toggle (generalized from lights-only, e2e/lights.spec.ts's own
 * `viewport.helpers-toggle` coverage) governing all kinds together, and the
 * RH-034 "never exported" guarantee extended to these two new kinds.
 */

const FRONT_CAMERA_POSE = { position: [0, 0, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };

// engine-three's own hex colors (packages/engine-three/src/render-host.ts):
// AUDIO_EMITTER_HELPER_COLOR = 0x22d3ee, AUDIO_ZONE_HELPER_COLOR = 0x8b5cf6.
const EMITTER_HELPER_RGB = { r: 34, g: 211, b: 238 };
const ZONE_HELPER_RGB = { r: 139, g: 92, b: 246 };

async function importAudioHelpersFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: AUDIO_HELPERS_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildAudioHelpersFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("audio-helpers-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((p) => window.__gltfStudioTest!.setCameraPose(p), FRONT_CAMERA_POSE);
}

/**
 * Whole-canvas color-presence scan (deliberately not a single center-pixel
 * sample, mirroring e2e/lights.spec.ts's own reasoning for using the count
 * hook rather than pixels for ITS OWN toggle test — a wireframe/translucent
 * helper's exact silhouette shifts with camera/geometry details in a way a
 * single sample point can't robustly land on): true if ANY pixel is close
 * enough to `target` — the helper's own solid-color wireframe edge pixels
 * (opacity 1, `buildTranslucentVolume`'s `LineBasicMaterial`) render at
 * close to the pure hue, so a generous-but-not-unbounded tolerance still
 * can't false-positive against this fixture's dark `0x11141a` background or
 * the other kind's own distinctly-hued helper.
 */
async function canvasHasColor(mount: Locator, target: { r: number; g: number; b: number }, tolerance = 40): Promise<boolean> {
  await mount.page().evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const buffer = await mount.screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    if (Math.abs(data[idx] - target.r) <= tolerance && Math.abs(data[idx + 1] - target.g) <= tolerance && Math.abs(data[idx + 2] - target.b) <= tolerance) {
      return true;
    }
  }
  return false;
}

test.describe("Audio viewport helpers: selected-always + shared helpers toggle, never exported (RH-035, UX-314)", () => {
  test("selecting the positional cone emitter shows its own cyan range/cone helper; deselecting hides it again", async ({ page }) => {
    await importAudioHelpersFixture(page);
    const mount = page.getByTestId("viewport.mount");

    await expect(await canvasHasColor(mount, EMITTER_HELPER_RGB)).toBe(false);

    await page.getByTestId(`scene-tree.row.${AUDIO_HELPERS_EMITTER_NODE_INDEX}`).click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(1);
    await expect(await canvasHasColor(mount, EMITTER_HELPER_RGB)).toBe(true);

    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + 4); // deselect (UX-303's empty-corner click, same pattern as e2e/lights.spec.ts).
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);
    await expect(await canvasHasColor(mount, EMITTER_HELPER_RGB)).toBe(false);
  });

  test("selecting the KHR_audio_environment zone shows its own violet volume helper; deselecting hides it again", async ({ page }) => {
    await importAudioHelpersFixture(page);
    const mount = page.getByTestId("viewport.mount");

    await expect(await canvasHasColor(mount, ZONE_HELPER_RGB)).toBe(false);

    await page.getByTestId(`scene-tree.row.${AUDIO_HELPERS_ZONE_NODE_INDEX}`).click();
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(1);
    await expect(await canvasHasColor(mount, ZONE_HELPER_RGB)).toBe(true);

    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);
    await expect(await canvasHasColor(mount, ZONE_HELPER_RGB)).toBe(false);
  });

  test("the shared 'Helpers' toggle shows BOTH kinds at once with nothing selected, and hides both when turned back off", async ({ page }) => {
    await importAudioHelpersFixture(page);
    const mount = page.getByTestId("viewport.mount");

    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);

    await page.getByTestId("viewport.helpers-toggle").click();
    await expect(page.getByTestId("viewport.helpers-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(2); // one emitter + one zone helper.
    await expect(await canvasHasColor(mount, EMITTER_HELPER_RGB)).toBe(true);
    await expect(await canvasHasColor(mount, ZONE_HELPER_RGB)).toBe(true);

    await page.getByTestId("viewport.helpers-toggle").click();
    await expect(page.getByTestId("viewport.helpers-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(0);
    await expect(await canvasHasColor(mount, EMITTER_HELPER_RGB)).toBe(false);
    await expect(await canvasHasColor(mount, ZONE_HELPER_RGB)).toBe(false);
  });

  test("GUARANTEE: toggling audio helpers on (plus a selection) never changes the exported bytes (RH-034 — helpers live only in the three.js scene, never the document)", async ({ page }) => {
    await importAudioHelpersFixture(page);

    const [download1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const baseline = readFileSync((await download1.path())!);

    await page.getByTestId("viewport.helpers-toggle").click(); // all-helpers ON.
    await page.getByTestId(`scene-tree.row.${AUDIO_HELPERS_EMITTER_NODE_INDEX}`).click(); // plus a selection, exercising the "selected always" path too.
    await expect.poll(() => page.evaluate(() => window.__gltfStudioTest!.getEditorHelperCount())).toBe(2);

    const [download2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    const withHelpersShown = readFileSync((await download2.path())!);

    expect(withHelpersShown.equals(baseline)).toBe(true);
  });
});
