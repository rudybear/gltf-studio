import { PNG } from "pngjs";
import { test, expect, type Page } from "@playwright/test";
import { buildUsageMappingFixtureBytes, USAGE_MAPPING_FIXTURE_NAME, USAGE_FIXTURE_NODE, USAGE_FIXTURE_GRAPH_NODE } from "./usage-mapping-fixture.js";
import { assertRegionsVisuallyDiffer } from "./visual-assert.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * specs/ux-usage-mapping.md UX-11xx: the Inspector's "Used in behavior"
 * section (UX-1106..1109), the → Graph / → Script jumps (UX-1107/UX-1108),
 * and the two-tier blue-selection/amber-reference-highlight vocabulary
 * (UX-1110..1112) — end to end, on a dedicated small fixture
 * (e2e/usage-mapping-fixture.ts) built specifically to exercise all three
 * reference families' forward/reverse resolution rather than reusing a
 * fixture pinned by unrelated specs.
 */

const AMBER_REF = { r: 0xd9, g: 0xa4, b: 0x41 }; // RH-029/RH-030's reference-highlight color (0xd9a441)
const BLUE_SELECTION_ISH = { r: 0x4d, g: 0x9d, b: 0xff }; // the hover-outline blue (0x4d9dff) — used here only to confirm the amber count below is NOT that color

function countPixelsNear(buffer: Buffer, target: { r: number; g: number; b: number }, tolerance = 20): number {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = i << 2;
    if (Math.abs(data[idx] - target.r) <= tolerance && Math.abs(data[idx + 1] - target.g) <= tolerance && Math.abs(data[idx + 2] - target.b) <= tolerance) {
      count++;
    }
  }
  return count;
}

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', {
    name: USAGE_MAPPING_FIXTURE_NAME,
    mimeType: "model/gltf-binary",
    buffer: buildUsageMappingFixtureBytes()
  });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("usage-mapping-fixture");
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
}

/**
 * specs/ux-script.md UX-712/UX-1108 (refined "character-precise, visibly-
 * decorated script jump"): a real screenshot of the exact on-screen pixels
 * a given 1-based Monaco model line currently occupies, via
 * `GltfStudioScriptTestHook.getLineScreenRect` (script-panel.tsx) — turns
 * "line N" into the same kind of real, composited-pixel evidence
 * `e2e/visual-assert.ts`'s helpers already demand elsewhere, rather than an
 * API-level assertion this bug report's own root cause showed can pass
 * while a real screen shows nothing different at all.
 */
async function screenshotLine(page: Page, lineNumber: number): Promise<Buffer> {
  const rect = await page.evaluate((line) => window.__gltfStudioScriptTest?.getLineScreenRect(line) ?? null, lineNumber);
  if (!rect) throw new Error(`getLineScreenRect(${lineNumber}) returned null — is the Script tab's Monaco editor mounted?`);
  // `getLineScreenRect`'s {top,left,width,height} (a plain DOMRect-ish shape,
  // matching `getBoundingClientRect()`'s own field names) needs remapping to
  // Playwright's `clip` shape ({x,y,width,height}).
  return page.screenshot({ clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
}

async function jumpHighlightLineNumber(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__gltfStudioScriptTest?.getJumpHighlightLineNumber() ?? null);
}

/** Toggles the app's theme override (`topbar.theme-toggle`) until `document.documentElement`'s `data-theme` reads `target` — robust regardless of whatever theme the run started in (system `prefers-color-scheme` isn't pinned by this suite). */
async function setTheme(page: Page, target: "light" | "dark"): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (current === target) return;
    await page.getByTestId("topbar.theme-toggle").click();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(target);
}

test.describe("usage mapping (specs/ux-usage-mapping.md UX-11xx)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("Used in behavior section: correct row anatomy for a pointer-referenced node (UX-1100/UX-1106/UX-1107)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    const row = page.getByTestId("inspector.usage.row.0");
    await expect(row).toContainText("pointer/set");
    await expect(row).toContainText("/nodes/0/translation");
    await expect(row).toContainText("Graph 0");
  });

  test("→ Graph jump switches the dock to Behavior graph, selects the referencing node, and opens its details card (UX-1107)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await page.getByTestId("inspector.usage.row.0.to-graph").click();

    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.node.1")).toHaveClass(/gcanvas-op-node-selected/);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/set");
    await expect(page.getByTestId("gcanvas.details")).toContainText("/nodes/0/translation");
  });

  test("→ Graph jump's details card offers Reveal in viewport for a node with a scene reference (UX-1111)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await page.getByTestId("inspector.usage.row.0.to-graph").click();
    const reveal = page.getByTestId("gcanvas.details.reveal");
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(page.getByTestId("toast")).toContainText("Framed");
  });

  test("→ Script jump selects the referencing node and cross-highlights its emitted identifier (UX-1108/UX-712)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("rt.onSelect(");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null))
      .toBe("onSelect");
  });

  test("REPRO: → Script jump on a pointer/set row (cold, script tab never opened) selects a real range in the emitted code", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
  });

  test("→ Script jump on a pointer/set row still works once the Script tab was already opened once (warm path, UX-1108)", async ({ page }) => {
    // Open the Script tab manually FIRST — Monaco mounts/loads on this open,
    // not on the jump below — before ever touching the usage row, so this
    // exercises the durable focus-request effect's already-ready branch
    // rather than its cold-mount queuing branch (which the REPRO/cold test
    // above covers).
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .not.toBe("");

    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();

    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
  });

  test("→ Script is disabled with a tooltip for a pointer/set row whose graph node is unreachable from any event handler (UX-1114)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_04}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    const row = page.getByTestId("inspector.usage.row.0");
    await expect(row).toContainText("pointer/set");
    const toScript = page.getByTestId("inspector.usage.row.0.to-script");
    await expect(toScript).toBeDisabled();
    await expect(toScript).toHaveAttribute("title", /isn't reachable/i);
    // → Graph is unaffected by this — the graph canvas doesn't need an
    // identifier, only the node's existence, so it stays enabled and usable
    // for an orphaned node exactly as it is for any other.
    await expect(page.getByTestId("inspector.usage.row.0.to-graph")).toBeEnabled();
  });

  test("zero-reference node shows the Attach-behavior menu; Ask Copilot opens with context; 'On select → Set property…' is now LIVE, not a stub (UX-1109/UX-1118, specs/ux-usage-mapping.md Phase 2)", async ({ page }) => {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_03}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Not referenced in behavior");
    await expect(page.getByTestId("inspector.usage.section")).not.toContainText("Used in behavior (");

    await page.getByTestId("inspector.usage.attach").click();
    await expect(page.getByTestId("inspector.usage.attach-menu")).toHaveClass(/open/);

    // Phase 2 (UX-1118): "On select → Set property…" now creates a REAL
    // event/onSelect + pointer/set node pair (one undo step) rather than
    // toasting "coming in a later phase" — see e2e/usage-mapping-p2.spec.ts
    // for this menu's full live-flow coverage (interpolate/play-sound/
    // play-animation too); this test just confirms the SAME fixture/node
    // Phase 1's own zero-ref case already covers picks it up correctly.
    await page.getByTestId("inspector.usage.attach-menu.set-property").click();
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.details")).toContainText("pointer/set");
    await expect(page.getByTestId("gcanvas.details")).toContainText(`/nodes/${USAGE_FIXTURE_NODE.PROP_03}/translation`);
    await page.getByTestId("pointer-picker.cancel").click(); // close the auto-opened retarget picker before interacting with the rest of the page
    await page.getByTestId("topbar.undo").click(); // restores PROP_03 to zero-ref for the assertions below

    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_03}`).click();
    await page.getByTestId("inspector.usage.attach").click();
    await page.getByTestId("inspector.usage.attach-menu.ask-copilot").click();
    await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
    await expect(page.getByTestId("copilot.context")).toContainText("Node #2");
  });

  test("reverse reference highlight: selecting a referencing graph node highlights the referenced scene node in the tree and viewport — amber, distinct from blue, coexisting with a different node's own selection, and clearing on deselect (UX-1110/UX-1112)", async ({
    page
  }) => {
    // Prop_01 gets the ordinary (blue) selection highlight...
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`)).toHaveClass(/selected/);

    const baselineBuffer = await page.getByTestId("viewport.mount").screenshot();
    const baselineAmber = countPixelsNear(baselineBuffer, AMBER_REF);

    // ...then selecting the event/onSelect graph node (references Prop_02,
    // nodeIndex: 1) drives Prop_02's amber reference highlight — a
    // DIFFERENT node than the one still holding the blue selection above,
    // demonstrating the two tiers coexist across different nodes at once.
    await page.getByTestId("dock.tab.graph").click();
    // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
    // comment): this tab was hidden-mounted (packages/graph-canvas/src/
    // graph-view.tsx's own "hidden-mount fitView" bug-fix note) — its nodes
    // only get their first REAL measured size once it becomes visible here,
    // same node-click/resize race e2e/graph-canvas.spec.ts's own
    // `waitForNodesSettled` guards against (task #33).
    await waitForNodesSettled(page);
    await clickNodeHeader(page, 0);

    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/ref-highlighted/);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`)).toHaveClass(/selected/); // unaffected

    const highlightedBuffer = await page.getByTestId("viewport.mount").screenshot();
    const highlightedAmber = countPixelsNear(highlightedBuffer, AMBER_REF);
    const highlightedBlueish = countPixelsNear(highlightedBuffer, BLUE_SELECTION_ISH);
    expect(highlightedAmber, "expected new amber-colored pixels once the reference highlight is active").toBeGreaterThan(baselineAmber + 20);
    // The amber outline and the pre-existing hover-blue tone are clearly
    // different colors — confirms this isn't a false-positive match from
    // some unrelated always-on blue UI chrome bleeding into the canvas.
    expect(highlightedAmber).toBeGreaterThan(highlightedBlueish);

    // Selecting Prop_02 in the tree TOO (now both selected AND reference-
    // highlighted on the SAME row) keeps both classes present — the
    // approved mockup's own coexistence rule for a shared row (CSS then
    // shows the blue treatment, but the amber condition still applies).
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`).click();
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/selected/);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).toHaveClass(/ref-highlighted/);

    // Clearing: deselecting the graph node (clicking the empty canvas pane)
    // clears the reference highlight with no separate "close" gesture.
    // Clicked in the pane's bottom-right corner, well clear of both graph
    // nodes (laid out near the top-left at extras.gltfi {20,20}/{320,20}).
    await page.getByTestId("dock.tab.graph").click();
    const paneBox = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.click(paneBox.x + paneBox.width - 20, paneBox.y + paneBox.height - 20);
    await expect(page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_02}`)).not.toHaveClass(/ref-highlighted/);

    await expect
      .poll(async () => countPixelsNear(await page.getByTestId("viewport.mount").screenshot(), AMBER_REF))
      .toBeLessThan(highlightedAmber);
  });
});

/**
 * specs/ux-script.md UX-712 / specs/ux-usage-mapping.md UX-1108 (refined
 * "character-precise, visibly-decorated script jump"): a follow-up bug
 * report on the original UX-1108 fix found that "→ Script" visibly did
 * nothing a user could actually see, even though the ORIGINAL fix's own
 * e2e coverage (the "REPRO"/"warm path" tests above) passed — those only
 * ever asserted `getSelectedText()`, an API-level read of Monaco's
 * selection model that stays correct even when the on-screen rendering of
 * that selection is Monaco's own near-invisible
 * `editor.inactiveSelectionBackground` tint (the editor never had real DOM
 * focus, since the jump arrives from a button OUTSIDE it). This suite adds
 * the missing layer: real screenshots proving a persistent, focus-
 * independent amber decoration is actually painted, plus its documented
 * clear semantics (a new jump, a genuine edit, a click elsewhere in the
 * buffer, or a ~5s fade with no further interaction) and its behavior
 * across the Script tab's own debounced emit-view regeneration.
 */
test.describe("→ Script jump: visible, persistent decoration (specs/ux-script.md UX-712/UX-715, specs/ux-usage-mapping.md UX-1108 refined)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  async function jumpToPointerRow(page: Page): Promise<void> {
    await page.getByTestId(`scene-tree.row.${USAGE_FIXTURE_NODE.PROP_01}`).click();
    await expect(page.getByTestId("inspector.usage.section")).toContainText("Used in behavior (1)");
    await page.getByTestId("inspector.usage.row.0.to-script").click();
    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null), { timeout: 15_000 })
      .toContain("/nodes/0/translation");
  }

  async function assertDecorationVisible(page: Page): Promise<number> {
    const line = await jumpHighlightLineNumber(page);
    expect(line, "expected a jump-highlight decoration line number once a jump has landed").not.toBeNull();
    const decoratedShot = await screenshotLine(page, line!);
    // Line 1 (the leading provenance comment, UX-705) is never a jump
    // target for this fixture's pointer/set row — a stable, always-present
    // "plain code" baseline to diff against.
    const baselineShot = await screenshotLine(page, 1);
    await assertRegionsVisuallyDiffer(decoratedShot, baselineShot);
    return line!;
  }

  test("cold jump (Script tab never opened) paints a real, visually-distinct amber decoration — dark theme (default)", async ({ page }) => {
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);
  });

  test("the same decoration is visible in the light theme too", async ({ page }) => {
    await setTheme(page, "light");
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);
  });

  test("warm jump (Script tab already open) paints the same visible decoration", async ({ page }) => {
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("script.panel")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .not.toBe("");
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);
  });

  test("the decoration survives the emit-view's own regeneration by re-resolving against the fresh text", async ({ page }) => {
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);

    // A real, reachable graph edit that changes the emitted code (adding a
    // handler root, always emitted regardless of reachability, per
    // cross-highlight.ts's own header comment on `sourceNodeIds`) — done
    // AWAY from the Script tab, exactly like the original bug report's own
    // "debounced emit-view regeneration may replace the model after the
    // jump" finding, not a direct edit of the Script buffer itself (that
    // is the SEPARATE "clears on user edit" case, covered below).
    await page.getByTestId("dock.tab.graph").click();
    await page.getByTestId("gcanvas.palette.search").fill("event/onHoverIn");
    await page.getByTestId("gcanvas.palette.op.event/onHoverIn").click();
    // The fixture graph already has 3 nodes (ON_SELECT, POINTER_SET,
    // ORPHAN_POINTER_SET — e2e/usage-mapping-fixture.ts) before this add.
    await expect(page.locator('[data-testid^="gcanvas.node."]')).toHaveCount(4);

    await page.getByTestId("dock.tab.script").click();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .toContain("rt.onHoverIn(");

    // Per this fix's spec'd semantics: the reference still resolves (the
    // pointer/set node itself was untouched), so the decoration is
    // RE-APPLIED (not cleared) against the regenerated text — still over
    // the exact same pointer path, still visibly distinct pixels, whether
    // or not its line number happened to move.
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null))
      .toContain("/nodes/0/translation");
    await assertDecorationVisible(page);
  });

  test("the decoration clears (rather than pointing at stale/wrong text) once its reference stops resolving at all — e.g. the referencing graph node is deleted", async ({
    page
  }) => {
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);

    await page.getByTestId("dock.tab.graph").click();
    // A plain `.click()` on the node testid's bounding-box CENTER can land on
    // this node's own `.gcanvas-op-pointer-row` (a pointer/set node's config
    // buttons, which `stopPropagation()` — op-node.tsx) instead of selecting
    // it; `.gcanvas-op-header` has no such interactive children and always
    // reaches React Flow's own node-click/selection handling.
    await page.getByTestId(`gcanvas.node.${USAGE_FIXTURE_GRAPH_NODE.POINTER_SET}`).locator(".gcanvas-op-header").click();
    await page.keyboard.press("Delete");
    // NOT asserted here: `gcanvas.node.${POINTER_SET}` reaching count 0 —
    // deleting a node re-indexes every LATER node down by one (DOC-019's
    // `fixupReferences`), so that exact testid can legitimately still exist
    // afterward (a DIFFERENT, renumbered node now answering to it). The
    // real assertions below (the emitted code losing the deleted node's own
    // pointer path, the jump highlight clearing) are what actually matters
    // here, not a particular node's on-screen index.

    await page.getByTestId("dock.tab.script").click();
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15_000 })
      .not.toContain("/nodes/0/translation");
    await expect.poll(() => jumpHighlightLineNumber(page)).toBeNull();
    expect(await page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null)).toBeNull();
  });

  test("clicking elsewhere in the buffer clears the decoration", async ({ page }) => {
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);

    const rect = await page.evaluate(() => window.__gltfStudioScriptTest!.getLineScreenRect(1)!);
    await page.mouse.click(rect.left + 5, rect.top + rect.height / 2);

    await expect.poll(() => jumpHighlightLineNumber(page)).toBeNull();
  });

  test("a real edit to the buffer clears the decoration", async ({ page }) => {
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);

    // `script-panel.tsx`'s own test-only `setValue` seam (its doc comment:
    // "drives the Monaco buffer the same way a real keystroke would") —
    // this repo's established way to simulate "the user typed something"
    // without a flaky raw-keyboard-into-Monaco interaction.
    await page.getByTestId("script.edit-toggle").click();
    const current = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    await page.evaluate((text) => window.__gltfStudioScriptTest!.setValue(text), `// edited\n${current}`);

    await expect.poll(() => jumpHighlightLineNumber(page)).toBeNull();
  });

  test("the decoration clears on its own after ~5s with no further interaction", async ({ page }) => {
    test.slow(); // a real (not mocked) ~5s+ wait, deliberately — see below.
    await jumpToPointerRow(page);
    await assertDecorationVisible(page);
    // A real, POLLED wait rather than one fixed `waitForTimeout` or
    // Playwright's clock-mocking API: this fade timer lives alongside a
    // debounced parse timer and several other `setTimeout`s in the same
    // component tree, so mocking a shared page clock risks side effects on
    // unrelated logic; polling (rather than a single fixed sleep) absorbs
    // ordinary CPU-contention jitter from this suite's own parallel workers
    // (playwright.config.ts's worker-count comment already documents this
    // repo hitting real scheduling contention under parallel e2e workers)
    // without just padding a flat sleep arbitrarily further.
    await expect.poll(() => jumpHighlightLineNumber(page), { timeout: 10_000, intervals: [250] }).toBeNull();
    expect(await page.evaluate(() => window.__gltfStudioScriptTest?.getSelectedText() ?? null)).toBeNull();
  });
});
