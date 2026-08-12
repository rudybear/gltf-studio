import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { writeContainer, type Container } from "@gltfi/gltf";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

const CHUNK_TYPE_JSON = 0x4e4f534a;

/**
 * A real, importable/exportable `.glb` whose exported bytes gzip to well
 * over UX-126's 300,000-byte share-link limit — an unreferenced buffer
 * carrying ~900KB of random (so, near-incompressible even base64-encoded)
 * bytes, embedded as a `data:` URI. Built on the fly (not a committed
 * fixture, per this program's "no corpus copying" rule) rather than reusing
 * `samples/r4-racer.glb`, which — despite being a genuinely large asset —
 * is mostly repetitive JSON/geometry and gzips down to only ~10KB, nowhere
 * near this limit.
 */
function buildLargeGlb(): Uint8Array {
  const raw = randomBytes(900_000);
  const json = {
    asset: { version: "2.0", generator: "gltf-studio e2e fixture" },
    scene: 0,
    scenes: [{ nodes: [] }],
    buffers: [{ byteLength: raw.byteLength, uri: `data:application/octet-stream;base64,${raw.toString("base64")}` }]
  };
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return writeContainer(container) as Uint8Array;
}

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

test.describe("share (specs/ux-shell.md UX-126/UX-127)", () => {
  test("a small asset gets a working share link; opening it in a fresh browser context loads the project", async ({ page, browser }) => {
    await importFixture(page);

    await page.getByTestId("topbar.share").click();
    await expect(page.getByTestId("share.dialog")).toBeVisible();
    await expect(page.getByTestId("share.link-output")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("share.too-large-note")).toHaveCount(0);

    const link = await page.getByTestId("share.link-output").inputValue();
    expect(link).toContain("#share=");

    // A brand-new browser context -- no shared storage/cookies with `page`
    // above -- simulating a different device/session opening the link.
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(link);

    await expect(page2.getByTestId("topbar.project-name")).toHaveText("shared-project");
    await expect(page2.getByTestId("scene-tree.row.1")).toBeVisible();
    // UX-127: the fragment is stripped once loaded -- a subsequent reload of
    // THIS same context behaves like any other open project, not a repeat import.
    expect(new URL(page2.url()).hash).toBe("");

    await context2.close();
  });

  test("an asset over the size limit falls back to download-only, with an honest too-large message", async ({ page }) => {
    const bytes = buildLargeGlb();
    const dir = mkdtempSync(join(tmpdir(), "gltf-studio-share-e2e-"));
    const filePath = join(dir, "large-fixture.glb");
    writeFileSync(filePath, bytes);

    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', filePath);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("large-fixture");

    await page.getByTestId("topbar.share").click();
    await expect(page.getByTestId("share.too-large-note")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("share.link-output")).toHaveCount(0);
    // The download path must still work regardless.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("share.download").click()]);
    expect(download.suggestedFilename()).toBe("large-fixture.glb");
  });
});
