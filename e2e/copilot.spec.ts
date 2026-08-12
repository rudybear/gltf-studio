import { test, expect, type Page, type Locator } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * M8 Copilot e2e coverage (specs/ux-copilot.md UX-1000/UX-1001/UX-1002/
 * UX-1003/UX-1004/UX-1005/UX-1006/UX-1007/UX-1008/UX-1009/UX-1010/UX-1011,
 * specs/agent-service.md AG-###): the context-chip row (UX-1001, removable
 * per UX-1002), the thread (UX-1003's alternating user/assistant messages,
 * pending "thinking…" bubble replaced by the resulting card), proposal
 * cards (UX-1004's badge row + expand/collapse command list, UX-1005's
 * pending/accepted/rejected action-row states, UX-1010's generated-asset
 * thumbnails), history integration (AG-004/AG-005/UX-1006/UX-1008: exactly
 * one "Copilot: <summary>" entry per accepted proposal, undoable as one
 * step), "Try in play" (UX-1007), and the inline "✦ Ask Copilot" entry
 * points (AG-015; scene-tree context menu per UX-207/UX-208, graph-canvas
 * palette per UX-511, Inspector identity strip per UX-1009).
 *
 * The fixture (e2e/global-setup.ts's `simple-scene.glb`, shared with
 * e2e/graph-canvas.spec.ts — DO NOT rely on any node/graph shape beyond
 * what that file documents) carries a real, inert `KHR_interactivity` graph
 * at `extensions.KHR_interactivity.graphs[0]` (2 nodes: event/onStart,
 * math/add, both unconnected) and a scene tree of Root(0){Widget(1){
 * Widget_Detail(3)}, KeyLight(2)} — depth-first flattened scene-tree rows
 * are therefore: row 0 = Root, row 1 = Widget, row 2 = Widget_Detail,
 * row 3 = KeyLight (same flatten e2e/play.spec.ts documents).
 *
 * `@gltf-studio/agent-mock`'s "play sound on click" template is
 * deliberately NOT covered here (per this task's own brief): it needs a
 * node with real bound `KHR_audio_emitter` audio, which this shared fixture
 * doesn't carry and which e2e/graph-canvas.spec.ts's own DO-NOT-EDIT note
 * forbids adding; it is already covered by packages/agent-mock's own unit
 * tests (phase 1). The other three templates (spin/rotate, move, add-cube)
 * plus accept/reject/undo/try-in-play/refusal/inline-✦-entry-points are
 * covered below instead.
 *
 * `window.__gltfStudioGraphTest` (installed by BehaviorGraphPanel.tsx,
 * mounted by default since `activeDockTab` starts as `"graph"`) is reused
 * from e2e/graph-canvas.spec.ts as the only seam to read
 * `extensions.KHR_interactivity` out of the live document.
 *
 * Proposal-card testids are namespaced by a locally-generated thread-entry
 * id (`copilot.proposal.{id}`, plus nested `.badge.*`/`.accept`/etc. under
 * that same prefix) that this file does not hardcode: `.copilot-proposal-
 * card` is a stable CSS class on exactly the card's own root (never its
 * nested badge/action rows), so `page.locator(".copilot-proposal-card")`
 * finds the card element regardless of its id, and its `data-testid`
 * attribute is read back at runtime to build precise nested-testid
 * selectors for that specific card.
 */

type RawInteractivityGraph = {
  types: Array<{ signature: string }>;
  declarations: Array<{ op: string }>;
  nodes: Array<{ declaration: number; values?: Record<string, unknown>; flows?: Record<string, unknown> }>;
};

async function importFixture(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  // BehaviorGraphPanel.tsx installs this hook alongside its own mount — the
  // default `activeDockTab` is "graph", so it's present as soon as the
  // document is loaded, with no dock-tab click required.
  await page.waitForFunction(() => window.__gltfStudioGraphTest !== undefined);
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

async function switchToCopilotTab(page: Page): Promise<void> {
  await page.getByTestId("right-panel.tab.copilot").click();
  await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
  await expect(page.getByTestId("copilot.panel")).toBeVisible();
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("copilot.composer.input");
  await input.fill(text);
  await page.getByTestId("copilot.composer.send").click();
}

/** Waits for (and returns) the most recently added proposal card, plus its own `data-testid` prefix for building nested selectors. */
async function lastProposalCard(page: Page): Promise<{ card: Locator; testId: string }> {
  const card = page.locator(".copilot-proposal-card").last();
  await expect(card).toBeVisible({ timeout: 10000 });
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("proposal card is missing its data-testid");
  return { card, testId };
}

/** Opens the history dropdown, reads its entries, then closes it again — leaves `topbar.history-dropdown` state as found. */
async function readHistoryEntries(page: Page): Promise<string[]> {
  await page.getByTestId("topbar.history-toggle").click();
  await expect(page.getByTestId("topbar.history-dropdown")).toBeVisible();
  const rows = page.locator('[data-testid^="topbar.history-dropdown.entry."]');
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) labels.push((await rows.nth(i).textContent()) ?? "");
  await page.getByTestId("topbar.history-toggle").click();
  await expect(page.getByTestId("topbar.history-dropdown")).toHaveCount(0);
  return labels;
}

test.describe("Copilot (specs/ux-copilot.md UX-1000..1011, specs/agent-service.md AG-###)", () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page);
  });

  test("selecting a node and sending a prompt auto-attaches a selection context chip (AG-012/UX-1001), removable per UX-1002", async ({ page }) => {
    await page.getByTestId("scene-tree.row.1").click(); // "Widget" (node 1)
    await switchToCopilotTab(page);

    await expect(page.getByTestId("copilot.context")).not.toContainText("Selection: Node #1");
    await sendPrompt(page, "spin it on click");

    // AG-012/AG-013: the selection auto-attaches, visibly, as a real chip —
    // exactly what's sent as `context`, not a hidden side channel.
    const chip = page.locator('[data-testid^="copilot.context.chip."]', { hasText: "Selection: Node #1" });
    await expect(chip).toBeVisible();

    // UX-1002: removing the chip removes it from the context row (it will not be sent with the next request).
    const chipTestId = await chip.getAttribute("data-testid");
    if (!chipTestId) throw new Error("chip is missing its data-testid");
    await page.getByTestId(`${chipTestId}.remove`).click();
    await expect(page.locator('[data-testid^="copilot.context.chip."]', { hasText: "Selection: Node #1" })).toHaveCount(0);
  });

  test('"spin it on click" -> proposal card -> Accept adds graph nodes as ONE history entry (UX-1005/UX-1006/UX-1008); undo removes it', async ({ page }) => {
    test.slow();
    await page.getByTestId("scene-tree.row.1").click(); // "Widget"
    await switchToCopilotTab(page);

    const before = await getGraphJson(page);
    expect(before.nodes).toHaveLength(2);

    await sendPrompt(page, "spin it on click");
    const { testId } = await lastProposalCard(page);

    // Validation passed; EQUIV n/a (spin never claims behavior-neutrality); at least one command.
    await expect(page.getByTestId(`${testId}.badge.validation`)).toHaveText(/passed/i);
    await expect(page.getByTestId(`${testId}.badge.equiv`)).toHaveText(/n\/a/i);
    await expect(page.getByTestId(`${testId}.badge.commands`)).toHaveText(/\d+ commands?/i);

    // UX-1004: the command list is collapsed by default, expands on toggle, and collapses again.
    await expect(page.getByTestId(`${testId}.commands`)).toHaveCount(0);
    await page.getByTestId(`${testId}.toggle`).click();
    await expect(page.getByTestId(`${testId}.commands`)).toBeVisible();
    await expect(page.getByTestId(`${testId}.commands`).locator("li").first()).not.toBeEmpty();
    await page.getByTestId(`${testId}.toggle`).click();
    await expect(page.getByTestId(`${testId}.commands`)).toHaveCount(0);

    await page.getByTestId(`${testId}.accept`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Applied/);

    // UX-1008: exactly one NEW history entry, labeled "Copilot: <summary>".
    const entries = await readHistoryEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^Copilot: /);

    // Two new graph nodes: an event/onSelect trigger + a pointer/interpolate action.
    const afterAccept = await getGraphJson(page);
    expect(afterAccept.nodes).toHaveLength(4);
    expect(afterAccept.declarations[afterAccept.nodes[2]!.declaration]!.op).toBe("event/onSelect");
    expect(afterAccept.declarations[afterAccept.nodes[3]!.declaration]!.op).toBe("pointer/interpolate");

    // Undo reverts the whole proposal as one step. (HistoryStack.entries()
    // deliberately keeps a redoable entry listed — DOC-039/history.ts's own
    // `entries()` doc comment: undo moves it to the redo log, it does not
    // vanish from the dropdown — so the observable proof of "undone" here is
    // `canUndo` flipping false and the document/graph actually reverting,
    // not the entry disappearing from the list.)
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    const afterUndo = await getGraphJson(page);
    expect(afterUndo.nodes).toHaveLength(2);
  });

  test("Reject leaves the document and history completely untouched (AG-009/UX-1005/UX-1006)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.1").click(); // "Widget"
    await switchToCopilotTab(page);

    const before = await getGraphJson(page);
    await sendPrompt(page, "spin it on click");
    const { testId } = await lastProposalCard(page);

    await page.getByTestId(`${testId}.reject`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Rejected/);

    // AG-009: zero document/history mutation.
    const entries = await readHistoryEntries(page);
    expect(entries).toHaveLength(0);
    const after = await getGraphJson(page);
    expect(after).toEqual(before);
  });

  test('"add 2 cubes" -> generated-asset swatches (UX-1010) -> Accept adds scene-tree rows as ONE history entry; undo removes both', async ({ page }) => {
    test.slow();
    await switchToCopilotTab(page); // no selection required for add-cube

    const rowCountBefore = await page.locator(".tree-row").count();

    await sendPrompt(page, "add 2 cubes");
    const { testId } = await lastProposalCard(page);

    await expect(page.getByTestId(`${testId}.assets`)).toBeVisible();
    await expect(page.getByTestId(`${testId}.asset.0`)).toBeVisible();
    await expect(page.getByTestId(`${testId}.asset.1`)).toBeVisible();
    await expect(page.getByTestId(`${testId}.asset.2`)).toHaveCount(0);

    await page.getByTestId(`${testId}.accept`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Applied/);

    const entries = await readHistoryEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^Copilot: /);

    await expect(page.locator(".tree-row")).toHaveCount(rowCountBefore + 2);
    await expect(page.locator(".tree-row", { hasText: "Copilot cube 1" })).toBeVisible();
    await expect(page.locator(".tree-row", { hasText: "Copilot cube 2" })).toBeVisible();

    // Undo reverts both new nodes/meshes/materials as one step (see the
    // spin test's own comment on why this checks `canUndo`/row-count, not
    // the history dropdown losing the entry — HistoryStack.entries() keeps a
    // just-undone, now-redoable entry listed).
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await expect(page.locator(".tree-row")).toHaveCount(rowCountBefore);
  });

  test("an unrecognized prompt produces an honest refusal message, never a proposal card", async ({ page }) => {
    await switchToCopilotTab(page);

    await sendPrompt(page, "make it rain and change the weather");

    const refusal = page.locator('[data-testid^="copilot.thread.refusal."]');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(/no copilot template recognizes this request/i);
    await expect(page.locator(".copilot-proposal-card")).toHaveCount(0);
  });

  test('Try in play (UX-1007) previews without engaging real play mode or mutating the document', async ({ page }) => {
    test.slow();
    await switchToCopilotTab(page);
    await sendPrompt(page, "add 1 cube");
    const { testId } = await lastProposalCard(page);

    await expect(page.getByTestId("locked-banner")).toHaveCount(0);

    await page.getByTestId(`${testId}.try-in-play`).click();
    await expect(page.getByTestId(`${testId}.try-in-play`)).toHaveText(/stop preview/i);
    await expect(page.getByTestId("viewport.preview-strip")).toBeVisible();
    await expect(page.getByTestId("viewport.preview-strip")).toContainText("Previewing Copilot proposal");

    // Deliberately distinct from real play mode (app-store.ts's `startTryInPlay` doc comment).
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);

    const entriesWhilePreviewing = await readHistoryEntries(page);
    expect(entriesWhilePreviewing).toHaveLength(0);

    await page.getByTestId(`${testId}.try-in-play`).click();
    await expect(page.getByTestId(`${testId}.try-in-play`)).toHaveText(/try in play/i);
    await expect(page.getByTestId("viewport.preview-strip")).toHaveCount(0);

    // Nothing was ever committed, start to finish.
    const entriesAfter = await readHistoryEntries(page);
    expect(entriesAfter).toHaveLength(0);
    await expect(page.locator(".tree-row", { hasText: "Copilot cube 1" })).toHaveCount(0);
  });

  test('right-click scene-tree row -> "✦ Ask Copilot about this…" switches tabs and attaches a chip (UX-207/UX-208/AG-015)', async ({ page }) => {
    await page.getByTestId("scene-tree.row.1").click({ button: "right" }); // "Widget"
    const menu = page.getByTestId("scene-tree.context-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("scene-tree.context-menu.frame")).toBeVisible();
    await expect(page.getByTestId("scene-tree.context-menu.rename")).toBeVisible();
    await expect(page.getByTestId("scene-tree.context-menu.ask-copilot")).toBeVisible();

    await page.getByTestId("scene-tree.context-menu.ask-copilot").click();

    await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
    await expect(page.getByTestId("copilot.context")).toContainText("Widget");

    // Bonus (cheap to verify): Frame doesn't crash, and Rename is a real edit.
    await page.getByTestId("scene-tree.row.1").click({ button: "right" });
    await page.getByTestId("scene-tree.context-menu.frame").click();
    await expect(page.getByTestId("scene-tree.context-menu")).toHaveCount(0);

    await page.getByTestId("scene-tree.row.1").click({ button: "right" });
    await page.getByTestId("scene-tree.context-menu.rename").click();
    const renameInput = page.getByTestId("scene-tree.row.1.rename-input");
    await renameInput.fill("Widget Renamed");
    await renameInput.press("Enter");
    await expect(page.getByTestId("scene-tree.row.1")).toContainText("Widget Renamed");
  });

  test("graph-canvas palette ✦ switches tabs and attaches a chip naming the current graph (UX-511/AG-015)", async ({ page }) => {
    await page.getByTestId("dock.tab.graph").click();
    await expect(page.getByTestId("gcanvas.palette.copilot")).toBeVisible();

    await page.getByTestId("gcanvas.palette.copilot").click();

    await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
    await expect(page.getByTestId("copilot.context")).toContainText("Graph 0");
  });

  test("Inspector identity-strip ✦ switches tabs and attaches a chip naming the current selection (UX-1009/AG-015)", async ({ page }) => {
    await page.getByTestId("scene-tree.row.1").click(); // "Widget"
    await page.getByTestId("right-panel.tab.inspector").click();
    await expect(page.getByTestId("inspector.identity")).toBeVisible();

    await page.getByTestId("inspector.identity.ask-copilot").click();

    await expect(page.getByTestId("right-panel.tab.copilot")).toHaveClass(/active/);
    await expect(page.getByTestId("copilot.context")).toContainText("Node #1");
  });
});
