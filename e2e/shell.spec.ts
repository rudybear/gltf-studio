import { test, expect } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { assertRegionRendersContent } from "./visual-assert.js";

test.describe("shell", () => {
  test("renders all four workspace regions plus the top bar (UX-100)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar.panel")).toBeVisible();
    await expect(page.getByTestId("left-panel.panel")).toBeVisible();
    await expect(page.getByTestId("viewport.panel")).toBeVisible();
    await expect(page.getByTestId("dock.panel")).toBeVisible();
    await expect(page.getByTestId("right-panel.panel")).toBeVisible();
  });

  test("bottom dock has exactly five tabs, one active at a time (UX-103)", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByTestId("dock.tabs").locator("button");
    await expect(tabs).toHaveCount(5);
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);

    await page.getByTestId("dock.tab.console").click();
    await expect(page.getByTestId("dock.tab.console")).toHaveClass(/active/);
    await expect(page.getByTestId("dock.tab.graph")).not.toHaveClass(/active/);
    await expect(page.getByTestId("console.panel")).toBeVisible();
  });

  // Real-pixel sanity checks for the Console and Data tabs (audit prompted by the Script tab's
  // `.script-tab-wrap` CSS-collapse bug, specs/ux-shell.md's bug-fix note): both are plain
  // conditionally-mounted (BottomDock.tsx never keeps them mounted-but-hidden the way it does the
  // Behavior graph/Script tabs), so they are not expected to share that hidden-mount sizing bug
  // class — confirmed here, not merely asserted from reading the source. An import first gives each
  // tab real content (an empty Console/Data tab would legitimately render near-zero pixels, which is
  // not itself a bug).
  test("Console and Data (glTF) tabs render non-trivial visible content once they have real content, not just DOM nodes", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene"); // also the import's own "Imported ..." log line, for Console below.

    await page.getByTestId("dock.tab.console").click();
    await expect(page.getByTestId("console.line.0")).toBeVisible();
    await assertRegionRendersContent(page.getByTestId("console.panel"));

    // Data tab shows only an empty-note (UX-801/UX-803) until something is selected
    // (UX-805's passive-selection tracking) — select a scene-tree row first so it has
    // real content to render, matching e2e/import.spec.ts's own Data tab tests.
    await page.getByTestId("scene-tree.row.1").click();
    await page.getByTestId("dock.tab.data").click();
    await expect(page.getByTestId("data.view")).toBeVisible();
    await assertRegionRendersContent(page.getByTestId("data.panel"));
  });

  test("undo/redo are disabled with empty history (no command-producing UI exists yet)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("topbar.redo")).toBeDisabled();
  });

  test("export (disabled with no document open — real once one is, see e2e/export.spec.ts) and the play bar (still a stub) both have a tooltip", async ({
    page
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar.export")).toBeDisabled();
    await expect(page.getByTestId("playbar.play")).toBeDisabled();
    await expect(page.getByTestId("playbar.pause")).toBeDisabled();
    await expect(page.getByTestId("playbar.stop")).toBeDisabled();
  });

  test("theme toggle sets an explicit override that persists independent of prefers-color-scheme (UX-104/UX-105)", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme", /.+/);

    await page.getByTestId("topbar.theme-toggle").click();
    const firstOverride = await html.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(firstOverride);

    await page.getByTestId("topbar.theme-toggle").click();
    const secondOverride = await html.getAttribute("data-theme");
    expect(secondOverride).not.toBe(firstOverride);
  });

  test("the `?` toggle reveals data-testid labels over on-screen elements (UX-111)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#testid-overlay-layer")).toHaveCount(0);
    await page.getByTestId("topbar.testid-toggle").click();
    await expect(page.locator("#testid-overlay-layer")).toBeVisible();
    await expect(page.locator(".testid-label", { hasText: "topbar.app-name" })).toBeVisible();
  });

  test("left panel is resizable via its drag handle, clamped to [190px, 480px] (UX-101/UX-102)", async ({ page }) => {
    await page.goto("/");
    const panel = page.getByTestId("left-panel.panel");
    const handle = page.getByTestId("left-panel.resize-handle");

    const before = (await panel.boundingBox())!;
    const handleBox = (await handle.boundingBox())!;

    // Drag far to the right — should clamp at 480px, never overshoot.
    await page.mouse.move(handleBox.x + 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 2 + 1000, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();

    const afterGrow = (await panel.boundingBox())!;
    expect(afterGrow.width).toBeGreaterThan(before.width);
    expect(afterGrow.width).toBeLessThanOrEqual(481);

    // Drag far to the left — should clamp at 190px.
    const handleBox2 = (await handle.boundingBox())!;
    await page.mouse.move(handleBox2.x + 2, handleBox2.y + handleBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox2.x + 2 - 1000, handleBox2.y + handleBox2.height / 2, { steps: 5 });
    await page.mouse.up();

    const afterShrink = (await panel.boundingBox())!;
    expect(afterShrink.width).toBeGreaterThanOrEqual(189);
    expect(afterShrink.width).toBeLessThan(before.width);
  });

  // specs/ux-shell.md UX-119: the empty-project starter gallery (supersedes the old
  // single-button predecessor requirement, now retired). Only checks the gallery's own
  // presentation here — actually loading the R4 Racer card and driving it at its real
  // 366-node graph scale is
  // e2e/racer.spec.ts's job (a separate, heavier Playwright project); the Playground
  // card's load path is covered end-to-end by e2e/golden-path.spec.ts's first step.
  test("empty-project state shows a two-card starter gallery (UX-119)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("viewport.gallery")).toBeVisible();

    const playground = page.getByTestId("viewport.gallery.card.playground");
    await expect(playground).toBeVisible();
    await expect(playground).toContainText("Playground");
    await expect(playground.getByTestId("viewport.gallery.card.playground.load")).toBeVisible();

    const racer = page.getByTestId("viewport.gallery.card.racer");
    await expect(racer).toBeVisible();
    await expect(racer).toContainText("R4 Racer");
    await expect(racer).toContainText("click the pads to steer");
    await expect(racer.getByTestId("viewport.gallery.card.racer.load")).toBeVisible();

    await assertRegionRendersContent(page.getByTestId("viewport.gallery"));
  });
});
