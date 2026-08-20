import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";
import { clickNodeHeader, waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * Variables panel (task: "in the node graph there is no way to edit
 * variables" — specs/ux-graph-canvas.md UX-515..518, specs/document-model.md
 * DOC-055): a NEW spec file (not e2e/graph-canvas.spec.ts, which is off
 * limits to a different concurrent workstream) covering the panel's own
 * add/rename/retype/default-value/delete flows against `GraphEdit`'s new
 * variable/event factories, plus the delete-blocks-when-used policy and
 * undo.
 *
 * Reuses e2e/graph-canvas.spec.ts's own fixture (FIXTURE_GLB_PATH,
 * simple-scene.glb — see e2e/global-setup.ts): its `KHR_interactivity` graph
 * already declares one variable ("counter", unreferenced by any node) —
 * exactly the "safe to delete" starting point this file's tests need,
 * without touching that fixture's own committed graph (DO NOT edit it, per
 * that file's header comment).
 */

type RawInteractivityGraph = {
  types: Array<{ signature: string }>;
  declarations: Array<{ op: string }>;
  variables?: Array<{ id?: string; type: number; value: Array<number | boolean | string> }>;
  events?: Array<{ id?: string }>;
  nodes: Array<{ declaration: number; configuration?: Record<string, { value: Array<number | boolean | string> }> }>;
};

async function importFixtureAndOpenVariables(page: Page): Promise<void> {
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
  await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
  await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
  // Panel starts collapsed (UX-515) — expand it once per test.
  await page.getByTestId("gcanvas.variables.expand").click();
  await expect(page.getByTestId("gcanvas.variables")).toBeVisible();
  // Pin pan/zoom (same test-only seam e2e/graph-canvas.spec.ts's own `importFixture` uses):
  // expanding the Variables panel narrows the canvas area, and an
  // uncontrolled `fitView` recompute can otherwise leave a JUST-ADDED
  // node's on-screen position overlapping the now-wider docked
  // panels (React Flow doesn't reproject existing/new node positions the
  // instant a sibling flex column resizes) — clicking a node whose real
  // bounding box lands under an `<aside>` fails Playwright's actionability
  // check ("element intercepts pointer events") even though the node is
  // "visible" by DOM presence. A pinned, known transform keeps every
  // subsequently-added node's screen position deterministic and clear of
  // both docked panels.
  await page.evaluate(() => window.__gltfStudioGraphCanvasTest!.setViewport({ x: 60, y: 60, zoom: 1 }));
  await expect
    .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
    .toContain("translate(60px, 60px) scale(1)");
  // Bug-fix note (deflake, see graph-canvas-test-helpers.ts's own doc
  // comment): reproduced offline under artificial CPU contention as the
  // same node-click/resize race e2e/graph-canvas.spec.ts's own
  // `waitForNodesSettled` guards against (task #33) — not previously
  // applied in this file. Repeated after every palette-add below.
  await waitForNodesSettled(page);
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

test.describe("Variables panel (specs/ux-graph-canvas.md UX-515..518, DOC-055)", () => {
  // A wider-than-default viewport (this project's other specs all use the
  // 1280x720 "Desktop Chrome" default): with the Variables panel expanded
  // ALONGSIDE the pre-existing palette + details panel, three fixed-width
  // docked columns can leave very little width for the actual canvas at
  // 1280px — real, but a LOCAL concern of tests that open this new panel,
  // not a reason to change `.gcanvas-root`'s shared CSS (which would risk
  // OTHER, unrelated specs' layout, including e2e/graph-canvas.spec.ts's own
  // — off limits to this workstream). Widening just these tests' own page
  // is the narrower, safer fix.
  test.use({ viewport: { width: 1600, height: 900 } });
  // CI's 2-worker cap (playwright.config.ts) is already documented (see
  // e2e/graph-canvas.spec.ts's own comments) as fragile to added concurrent
  // load — several of its drag/pixel-precision-sensitive tests are known to
  // need extra timeout budget whenever a new spec file adds more
  // simultaneously-running heavy (ELK layout / React Flow) browser
  // instances. Serializing THIS file's own tests (rather than editing that
  // off-limits file's timeouts) keeps this workstream's addition from
  // increasing peak concurrency, without touching anything it doesn't own.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await importFixtureAndOpenVariables(page);
  });

  test("lists the fixture's declared variable, and its usage count is 0 (unreferenced)", async ({ page }) => {
    await expect(page.getByTestId("gcanvas.variables.row.0")).toBeVisible();
    await expect(page.getByTestId("gcanvas.variables.name.0")).toHaveValue("counter");
    await expect(page.getByTestId("gcanvas.variables.usage.0")).toContainText("0");
    await expect(page.getByTestId("gcanvas.variables.delete.0")).toBeEnabled();
  });

  test("+ Add variable appends a fresh variable; renaming, retyping, and setting its default all write the document (UX-515)", async ({ page }) => {
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await page.getByTestId("gcanvas.variables.add").click();
    await expect(page.getByTestId("gcanvas.variables.row.1")).toBeVisible();
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();

    let graph = await getGraphJson(page);
    expect(graph.variables?.[1]).toMatchObject({ type: 0, value: [false] });

    // Rename.
    const name = page.getByTestId("gcanvas.variables.name.1");
    await name.fill("myVar");
    await name.blur();
    await expect.poll(async () => (await getGraphJson(page)).variables?.[1]?.id).toBe("myVar");

    // Retype float3 -> the default-value editor becomes 3 grouped numeric fields.
    await page.getByTestId("gcanvas.variables.type.1").selectOption("float3");
    await expect.poll(async () => {
      graph = await getGraphJson(page);
      const typeIndex = graph.variables?.[1]?.type;
      return typeIndex !== undefined ? graph.types[typeIndex]?.signature : undefined;
    }).toBe("float3");
    await expect.poll(async () => (await getGraphJson(page)).variables?.[1]?.value).toEqual([0, 0, 0]);

    // Set the default value via the grouped x/y/z fields.
    const editorBase = "gcanvas.variables.default.1.editor";
    await page.getByTestId(`${editorBase}.x`).fill("1");
    await page.getByTestId(`${editorBase}.x`).blur();
    await page.getByTestId(`${editorBase}.y`).fill("2");
    await page.getByTestId(`${editorBase}.y`).blur();
    await expect.poll(async () => (await getGraphJson(page)).variables?.[1]?.value).toEqual([1, 2, 0]);
  });

  test("deletes an UNUSED variable (UX-516); undo restores it", async ({ page }) => {
    await page.getByTestId("gcanvas.variables.delete.0").click();
    await expect(page.getByTestId("gcanvas.variables.row.0")).toHaveCount(0);
    await expect.poll(async () => (await getGraphJson(page)).variables?.length ?? 0).toBe(0);

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("gcanvas.variables.row.0")).toBeVisible();
    await expect(page.getByTestId("gcanvas.variables.name.0")).toHaveValue("counter");
  });

  test("blocks deleting an IN-USE variable, with an exact usage count (UX-516, DOC-055)", async ({ page }) => {
    // Make "counter" (index 0) in-use: add a variable/get node and assign it via the config editor's existing "variable" selector.
    await page.getByTestId("gcanvas.palette.op.variable/get").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();
    await waitForNodesSettled(page); // node 2 was just added — see importFixtureAndOpenVariables's own doc comment
    await clickNodeHeader(page, 2);
    await expect(page.getByTestId("gcanvas.node.2")).toHaveClass(/gcanvas-op-node-selected/);
    await page.getByTestId("gcanvas.details.config.variable-select.2").selectOption("0");

    await expect.poll(async () => {
      const graph = await getGraphJson(page);
      return graph.nodes[2]?.configuration?.variable?.value?.[0];
    }).toBe(0);

    await expect(page.getByTestId("gcanvas.variables.usage.0")).toContainText("1");
    const deleteBtn = page.getByTestId("gcanvas.variables.delete.0");
    await expect(deleteBtn).toBeDisabled();

    // Still declared afterward (delete never actually ran).
    await expect.poll(async () => (await getGraphJson(page)).variables?.length).toBe(1);
  });

  test("custom events: add, rename, and delete-blocked-when-used (UX-516)", async ({ page }) => {
    await page.getByTestId("gcanvas.events.add").click();
    await expect(page.getByTestId("gcanvas.events.row.0")).toBeVisible();
    const name = page.getByTestId("gcanvas.events.name.0");
    await name.fill("myEvent");
    await name.blur();
    await expect.poll(async () => (await getGraphJson(page)).events?.[0]?.id).toBe("myEvent");

    // Unused -> deletable.
    await expect(page.getByTestId("gcanvas.events.delete.0")).toBeEnabled();
    await page.getByTestId("gcanvas.events.add").click(); // re-add a second one to reference, keep the first as a delete target
    await expect(page.getByTestId("gcanvas.events.row.1")).toBeVisible();

    // Reference event #1 from an event/send node, then confirm #1's delete is blocked while #0 stays deletable.
    await page.getByTestId("gcanvas.palette.op.event/send").click();
    await expect(page.getByTestId("gcanvas.node.2")).toBeVisible();
    await waitForNodesSettled(page); // node 2 was just added — see importFixtureAndOpenVariables's own doc comment
    await clickNodeHeader(page, 2);
    await page.getByTestId("gcanvas.details.config.event-select.2").selectOption("1");
    await expect.poll(async () => (await getGraphJson(page)).nodes[2]?.configuration?.event?.value?.[0]).toBe(1);

    await expect(page.getByTestId("gcanvas.events.usage.1")).toContainText("1");
    await expect(page.getByTestId("gcanvas.events.delete.1")).toBeDisabled();
    await expect(page.getByTestId("gcanvas.events.delete.0")).toBeEnabled();
  });
});
