import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_FRONT_CAMERA_POSE } from "./global-setup.js";
import {
  multiFileFixtureComplete,
  multiFileFixtureGltfOnly,
  MULTI_FILE_BIN_NAME,
  MULTI_FILE_GLTF_NAME,
  MULTI_FILE_WAV_NAME
} from "./multi-file-fixture.js";

/**
 * Regression coverage for the reported bug (a multi-file `.gltf` import
 * showed the scene tree but rendered no meshes) and its fix
 * (specs/ux-shell.md UX-115/UX-116, `packages/app/src/lib/pack-gltf.ts`):
 * TopBar's `topbar.import-input` now accepts a multi-file selection, packs
 * a `.gltf` + its external `buffers[].uri`/`KHR_audio_emitter.audio[].uri`
 * siblings into one self-contained GLB before import (UX-115), and fails
 * loudly — never a silent empty viewport — when a sibling is missing
 * (UX-116). Verified for real against the actual user-reported drum-kit
 * asset separately (not committed to this repo); this fixture is a small
 * synthetic stand-in with the same shape (external `.bin` + external
 * `KHR_audio_emitter` `.wav`) for CI/local regression coverage.
 */

async function setFrontCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((pose) => window.__gltfStudioTest!.setCameraPose(pose), FIXTURE_FRONT_CAMERA_POSE);
}

/** UX-300-style check (mirrors e2e/viewport.spec.ts's own helper): a real rendered scene has more than one distinct pixel color. */
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

function audioDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => window.__gltfStudioAudioTest?.diagnostics() ?? "no hook");
}

test.describe("multi-file .gltf import (UX-115)", () => {
  test("a .gltf + external .bin + external KHR_audio_emitter .wav packs into one self-contained document that actually renders and plays (UX-115)", async ({
    page
  }) => {
    await page.goto("/");
    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureComplete());
    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");

    // Scene tree shows the real hierarchy -- not just JSON parsed without
    // its binary (the reported bug's exact symptom), but a document whose
    // mesh/accessor data actually resolved.
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Widget");
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Speaker");

    // Meshes actually render (not a blank canvas) AND are pickable -- the
    // packed buffer's accessors resolved to real geometry, not dangling
    // indices into bytes nobody supplied.
    await setFrontCamera(page);
    await expect(page.locator("#viewport-mount canvas")).toBeVisible();
    expect(await canvasHasVariedPixels(page)).toBe(true);

    const mount = page.getByTestId("viewport.mount");
    const box = (await mount.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("scene-tree.row.0")).toHaveClass(/selected/);
    await expect(page.getByTestId("viewport.selection-label")).toContainText("Widget");

    // The external .wav actually decodes -- packMultiFileGltf embedded it as
    // a bufferView, and WebAudioHost.loadEmitters/decodeAudioData resolves
    // bufferView audio against the packed GLB's real binary chunk (not a
    // dangling external uri nobody could fetch).
    await page.getByTestId("scene-tree.row.1").click(); // "Speaker"
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();
    await expect.poll(() => audioDiagnostics(page)).toBe("audio idle"); // AH-001: no AudioContext before the gesture below.
    await page.getByTestId("inspector.audio.audition").click();
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    const diagnostics = await audioDiagnostics(page);
    expect(diagnostics).toContain("1 buffer");
    expect(diagnostics).toContain("1 emitter");
  });

  test("a .gltf missing its .bin/.wav siblings fails loudly and leaves the current document untouched (UX-116)", async ({ page }) => {
    await page.goto("/");

    // Establish a real document first so "untouched" is a meaningful assertion.
    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureComplete());
    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");

    // Re-select just the .gltf -- both its external references are now unresolvable.
    await page.setInputFiles('[data-testid="topbar.import-input"]', multiFileFixtureGltfOnly());

    const toast = page.getByTestId("toast");
    await expect(toast).toBeVisible();
    const toastText = await toast.textContent();
    expect(toastText).toContain(MULTI_FILE_BIN_NAME);
    expect(toastText).toContain(MULTI_FILE_WAV_NAME);
    expect(toastText).toContain(MULTI_FILE_GLTF_NAME);

    // Document unchanged -- never a silently empty/partial viewport.
    await expect(page.getByTestId("topbar.project-name")).toHaveText("multi-file-scene");
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(2);
  });
});
