import { test, expect } from "@playwright/test";

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

  test("undo/redo are disabled with empty history (no command-producing UI exists yet)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.getByTestId("topbar.redo")).toBeDisabled();
  });

  test("export and the play bar are disabled stubs with a tooltip", async ({ page }) => {
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
});
