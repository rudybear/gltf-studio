import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { parseContainer } from "@gltfi/gltf";
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

  // specs/ux-shell.md UX-120: the empty-project starter gallery. Only checks the
  // gallery's own presentation here — actually loading the R4 Racer card and driving it
  // at its real 366-node graph scale is e2e/racer.spec.ts's job (a separate, heavier
  // Playwright project); the Empty scene card's own document-creation path is covered
  // end-to-end by the dedicated test below.
  test("empty-project state shows a two-card starter gallery: Empty scene + R4 Racer, no Playground (UX-120)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("viewport.gallery")).toBeVisible();

    const empty = page.getByTestId("viewport.gallery.card.empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Empty scene");
    await expect(empty).toContainText("Start from scratch");
    await expect(empty.getByTestId("viewport.gallery.card.empty.load")).toBeVisible();

    const racer = page.getByTestId("viewport.gallery.card.racer");
    await expect(racer).toBeVisible();
    await expect(racer).toContainText("R4 Racer");
    await expect(racer).toContainText("click the pads to steer");
    await expect(racer.getByTestId("viewport.gallery.card.racer.load")).toBeVisible();

    // The old, now-retired "Playground" card must be gone entirely, not merely hidden.
    await expect(page.getByTestId("viewport.gallery.card.playground")).toHaveCount(0);

    await assertRegionRendersContent(page.getByTestId("viewport.gallery"));
  });

  // specs/ux-shell.md UX-120: the Empty scene card's whole point is that the resulting
  // zero-node document behaves like any other real document, not a special-cased blank
  // mode — driven here through scene tree, add-menu, and export exactly as
  // e2e/scene-tree-add-menu.spec.ts and e2e/export.spec.ts already do for populated
  // fixtures, so a regression in any of that zero-node tolerance shows up here.
  test("Empty scene card creates a real, zero-node document that tolerates the tree empty state, an immediate Add, and export (UX-120)", async ({
    page
  }) => {
    await page.goto("/");
    await page.getByTestId("viewport.gallery.card.empty.load").click();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("Untitled");

    // Scene tree: a dedicated empty-scene note, not the "no document" one and not a
    // silently blank list.
    await expect(page.getByTestId("scene-tree.empty")).toHaveCount(0);
    await expect(page.getByTestId("scene-tree.empty-scene")).toBeVisible();
    await expect(page.getByTestId("scene-tree.list").locator(".tree-row")).toHaveCount(0);

    // Behavior graph tab: UX-714's existing no-graph empty state (this document has no
    // KHR_interactivity extension at all).
    await expect(page.getByTestId("gcanvas.empty")).toBeVisible();

    // + Add works immediately against a document with no nodes[] array at all yet.
    // (UX-206/UX-213: the new node lands auto-selected with its default name open in
    // the inline-rename input — same affordance e2e/scene-tree-add-menu.spec.ts's own
    // "Empty Group" test asserts via the rename-input's value, not the row's plain
    // text content, since the rename `<input>` replaces the label while it's open.)
    await page.getByTestId("scene-tree.add").click();
    await page.getByTestId("scene-tree.add-menu.mesh").click();
    await page.getByTestId("scene-tree.add-menu.mesh.cube").click();
    await expect(page.getByTestId("scene-tree.empty-scene")).toHaveCount(0);
    await expect(page.getByTestId("scene-tree.row.0.rename-input")).toHaveValue("Cube");
    await expect(page.getByTestId("scene-tree.row.0")).toHaveClass(/selected/);
    await page.keyboard.press("Enter"); // commit the default name so the row shows plain text again
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Cube");

    // Export: a real, valid, GLB — same header checks e2e/golden-path.spec.ts's export
    // step and e2e/export.spec.ts already use.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    await expect(page.getByTestId("toast").last()).toContainText("Export complete");
    const downloadPath = await download.path();
    const bytes = readFileSync(downloadPath!);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67); // "glTF" magic
    expect(bytes.readUInt32LE(4)).toBe(2); // version 2

    const reparsed = parseContainer(new Uint8Array(bytes));
    expect(reparsed.kind).toBe("glb");
    expect((reparsed.json as { nodes?: unknown[] }).nodes).toHaveLength(1);
  });
});
