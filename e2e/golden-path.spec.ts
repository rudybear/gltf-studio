import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { parseContainer } from "@gltfi/gltf";
import { validateGraph, type VGraph } from "@gltfi/verify";

/**
 * The checkpoint golden path: ONE serial test driving the full user
 * journey against the BUILT app with the committed checkpoint sample asset
 * (samples/playground.glb, scripts/make-sample.mjs), touching every shipped
 * feature area in one continuous session — load sample, scene tree,
 * inspector, gizmo+undo, behavior graph editing, pointer picker, the script
 * tab's emit/edit/apply round trip, both play engines, audio, Copilot, and
 * export.
 *
 * Runs as its own Playwright PROJECT (playwright.config.ts's "golden-path"
 * project, `dependencies: ["chromium"]`) so it always starts after every
 * other spec file's "chromium" project run has finished, and — being a
 * single `test()` — is inherently serial within itself; no cross-test
 * ordering concerns.
 *
 * The sample's graph-node indices referenced below (10 = the onTick
 * rotation `pointer/set`, 18 = the onSelect audio-trigger `pointer/set`)
 * are exactly scripts/make-sample.mjs's own hardcoded node numbering — see
 * that file's `buildInteractivityGraph` for the authoritative layout. Scene
 * node indices (Root=0, Ground=1, SpinningCube=2, ButtonSphere=3,
 * TogglePillar=4, Speaker=5, Lamp=6, Cam=7) come from the same script's
 * `buildSceneJson`, and — since every node there is a direct, non-nested
 * child of Root — line up 1:1 with scene-tree row index.
 *
 * cites: specs/ux-shell.md UX-114 (the "Load sample scene" button this
 * spec's first step exercises).
 */

const ARTIFACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "artifacts", "golden-path");

/** Sample's KHR_interactivity graph node indices (scripts/make-sample.mjs). */
const GRAPH_NODE = { ROTATE_POINTER_SET: 10, AUDIO_TRIGGER_POINTER_SET: 18 } as const;
/** Sample's scene node indices == scene-tree row indices (flat hierarchy). */
const SCENE_NODE = { GROUND: 1, SPINNING_CUBE: 2, BUTTON_SPHERE: 3, TOGGLE_PILLAR: 4, SPEAKER: 5 } as const;

/** Frames ButtonSphere ([0, 0.5, 0]) dead-center; SpinningCube (x=-1.6) and TogglePillar (x=1.6) fall well clear of screen center. */
const CAMERA_POSE = {
  position: [0, 0.5, 5] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  target: [0, 0.5, 0] as [number, number, number]
};

type RawInteractivityGraph = {
  types: Array<{ signature: string }>;
  declarations: Array<{ op: string }>;
  variables?: Array<{ id?: string; type: number; value?: unknown[] }>;
  nodes: Array<{
    declaration: number;
    values?: Record<string, unknown>;
    flows?: Record<string, { node: number; socket: string }>;
    configuration?: Record<string, { value: unknown[] }>;
  }>;
};

let stepCounter = 0;
async function snap(page: Page, name: string): Promise<void> {
  stepCounter += 1;
  await page.screenshot({ path: join(ARTIFACTS_DIR, `${String(stepCounter).padStart(2, "0")}-${name}.png`) });
}

async function setCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gltfStudioTest?.isReady() === true);
  await page.evaluate((pose) => window.__gltfStudioTest!.setCameraPose(pose), CAMERA_POSE);
}

/** A dead-center click on the viewport mount, under `setCamera`'s pose, hits ButtonSphere alone. */
async function clickButtonSphereInViewport(page: Page): Promise<void> {
  const mount = page.getByTestId("viewport.mount");
  const box = (await mount.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function getGraphJson(page: Page): Promise<RawInteractivityGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawInteractivityGraph[] } } }).extensions.KHR_interactivity.graphs[0];
}

function audioDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => window.__gltfStudioAudioTest?.diagnostics() ?? "no hook");
}

async function readVal(row: Locator): Promise<string> {
  return (await row.locator(".val").textContent()) ?? "";
}

async function readHistoryEntries(page: Page): Promise<string[]> {
  await page.getByTestId("topbar.history-toggle").click();
  await expect(page.getByTestId("topbar.history-dropdown")).toBeVisible();
  const rows = page.locator('[data-testid^="topbar.history-dropdown.entry."]');
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) labels.push((await rows.nth(i).textContent()) ?? "");
  await page.getByTestId("topbar.history-toggle").click();
  await expect(page.getByTestId("topbar.history-dropdown")).toHaveCount(0);
  return labels;
}

async function lastProposalCard(page: Page): Promise<{ card: Locator; testId: string }> {
  const card = page.locator(".copilot-proposal-card").last();
  await expect(card).toBeVisible({ timeout: 10000 });
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("proposal card is missing its data-testid");
  return { card, testId };
}

test.beforeAll(() => {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
});

test.describe.configure({ mode: "serial" });

test("golden path: sample scene through every shipped feature", async ({ page }) => {
  test.slow();
  test.setTimeout(300_000);

  await test.step("load sample scene from the empty-project state (UX-114)", async () => {
    await page.goto("/");
    await expect(page.getByTestId("viewport.load-sample")).toBeVisible();
    await page.getByTestId("viewport.load-sample").click();
    await expect(page.getByTestId("topbar.project-name")).toHaveText("playground");
    await snap(page, "load-sample");
  });

  await test.step("scene tree is populated with the sample's 8 flat nodes", async () => {
    const rows = page.getByTestId("scene-tree.list").locator(".tree-row");
    await expect(rows).toHaveCount(8);
    await expect(page.getByTestId("scene-tree.row.0")).toContainText("Root");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.BUTTON_SPHERE}`)).toContainText("ButtonSphere");
    await expect(page.getByTestId(`scene-tree.row.${SCENE_NODE.TOGGLE_PILLAR}`)).toContainText("TogglePillar");
    await snap(page, "scene-tree");
  });

  await test.step("select ButtonSphere in the viewport; inspector shows identity + transform", async () => {
    await setCamera(page);
    await clickButtonSphereInViewport(page);
    await expect(page.getByTestId("scene-tree.row.3")).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.identity")).toContainText("Node #3");
    await expect(page.getByTestId("inspector.identity")).toContainText("/nodes/3");
    await expect(page.getByTestId("inspector.transform.position-y")).toHaveValue("0.5");
    await snap(page, "select-button-inspector");
  });

  await test.step("gizmo move via test hook, then undo", async () => {
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    const committed = await page.evaluate(() => window.__gltfStudioTest!.simulateGizmoDrag([1, 0, 0]));
    expect(committed).toBe(true);
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("1");
    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await snap(page, "gizmo-move");

    await page.getByTestId("topbar.undo").click();
    await expect(page.getByTestId("inspector.transform.position-x")).toHaveValue("0");
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    await snap(page, "gizmo-undo");
  });

  await test.step("graph tab: nodes visible, add a debug/log node, connect a flow", async () => {
    await expect(page.getByTestId("dock.tab.graph")).toHaveClass(/active/);
    await expect(page.getByTestId("gcanvas.root")).toBeVisible();
    await expect(page.locator('[data-testid^="gcanvas.node."]')).toHaveCount(19);
    await snap(page, "graph-tab-loaded");

    await page.getByTestId("gcanvas.palette.search").fill("debug/log");
    await page.getByTestId("gcanvas.palette.op.debug/log").click();
    await expect(page.getByTestId("gcanvas.node.19")).toBeVisible();
    let graph = await getGraphJson(page);
    expect(graph.nodes).toHaveLength(20);
    expect(graph.declarations[graph.nodes[19]!.declaration]!.op).toBe("debug/log");
    await snap(page, "graph-add-debug-node");

    // Reroutes onStart's single flow output from the "set `ready`" node onto
    // the new debug/log node instead -- harmless for the rest of this
    // journey (nothing below reads the `ready` variable), and demonstrates
    // a real connect gesture through the exact same onConnect handler a
    // physical drag would use (see graph-canvas.spec.ts's own
    // `simulateConnect` doc comment for why the drag itself is synthesized
    // but every bit of downstream logic is real).
    await page.evaluate(() =>
      window.__gltfStudioGraphCanvasTest!.simulateConnect({
        source: "0",
        sourceHandle: "flow-out:out",
        target: "19",
        targetHandle: "flow-in:in"
      })
    );
    graph = await getGraphJson(page);
    expect(graph.nodes[0]!.flows!.out).toEqual({ node: 19, socket: "in" });
    await snap(page, "graph-connect-flow");
  });

  await test.step("pointer picker: retarget the onTick rotation pointer/set, then undo back to the original target", async () => {
    // `dispatchEvent("click")` rather than a coordinate-based `.click()`:
    // at this graph's size (20 nodes) fitView's auto-zoom packs nodes
    // tightly enough that a neighboring OpNode row can overlap this icon's
    // hit box (same class of layout-dependent flakiness graph-canvas.spec.ts's
    // own `simulateConnect` doc comment describes for drag gestures on a
    // canvas this dense) -- a coordinate click (even `force: true`, which
    // still computes and clicks a screen point) risked landing on the
    // wrong element under that overlap. Dispatching the DOM event directly
    // on the matched element invokes its exact real onClick handler with no
    // hit-testing at all.
    await page.getByTestId(`gcanvas.pointer-icon.${GRAPH_NODE.ROTATE_POINTER_SET}`).dispatchEvent("click");
    const dialog = page.getByTestId("pointer-picker.dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/2/rotation");

    // Depth-first tree order: 0 Root, 1 Ground, 2 SpinningCube, ... — retarget to Ground's translation.
    await page.getByTestId(`pointer-picker.tree.nodes.${SCENE_NODE.GROUND}`).click();
    await page.getByTestId("pointer-picker.prop.translation").click();
    await expect(page.getByTestId("pointer-picker.path")).toHaveText("/nodes/1/translation");
    await page.getByTestId("pointer-picker.confirm").click();
    await expect(dialog).toBeHidden();

    let graph = await getGraphJson(page);
    expect(graph.nodes[GRAPH_NODE.ROTATE_POINTER_SET]!.configuration!.pointer.value).toEqual(["/nodes/1/translation"]);
    await snap(page, "pointer-picker-retarget");

    await page.getByTestId("topbar.undo").click();
    graph = await getGraphJson(page);
    expect(graph.nodes[GRAPH_NODE.ROTATE_POINTER_SET]!.configuration!.pointer.value).toEqual(["/nodes/2/rotation"]);
    await snap(page, "pointer-picker-undo");
  });

  await test.step("script tab: emit view shows real code; edit + Apply -> Graph round trip; undo restores the original graph", async () => {
    test.slow();
    await page.getByTestId("dock.tab.script").click();
    await expect(page.getByTestId("dock.tab.script")).toHaveClass(/active/);
    await expect
      .poll(() => page.evaluate(() => window.__gltfStudioScriptTest?.getCode() ?? ""), { timeout: 15000 })
      .toContain("rt.onStart(");
    const code = await page.evaluate(() => window.__gltfStudioScriptTest!.getCode());
    expect(code).toContain("createEngine");
    expect(code).toContain("rt.onTick(");
    expect(code).toContain("rt.onSelect(");
    await expect(page.getByTestId("script.equiv-badge")).toHaveText("EQUIV ✓");
    await snap(page, "script-emit-view");

    const before = await getGraphJson(page);

    await page.getByTestId("script.edit-toggle").click();
    const marker = "rt.onStart(() => {";
    const insertAt = code.indexOf(marker) + marker.length;
    const edited = `${code.slice(0, insertAt)}\n    V.angle = V.angle + 1;${code.slice(insertAt)}`;
    await page.evaluate((text) => window.__gltfStudioScriptTest!.setValue(text), edited);

    await expect(page.getByTestId("script.equiv-badge")).toHaveText("DIVERGED ⚠", { timeout: 15000 });
    await snap(page, "script-diverged");

    await page.getByTestId("script.apply").click();
    await expect(page.getByTestId("script.equiv-badge")).toHaveText("EQUIV ✓");
    const afterApply = await getGraphJson(page);
    expect(afterApply.nodes.length).toBeGreaterThan(before.nodes.length);
    expect(validateGraph(afterApply as unknown as VGraph).ok).toBe(true);
    await snap(page, "script-applied");

    await page.getByTestId("topbar.undo").click();
    const undone = await getGraphJson(page);
    expect(undone).toEqual(before);
    await snap(page, "script-undo");
  });

  await test.step("audition (edit mode): AH-001's user gesture happens here, BEFORE play mode — regression coverage for the audio-host-keying bug (fixed: WebAudioHost now survives HistoryStack.freeze()/unfreeze(), specs/ux-shell.md M7 follow-up)", async () => {
    await page.getByTestId(`scene-tree.row.${SCENE_NODE.SPEAKER}`).click();
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();
    await page.getByTestId("inspector.audio.audition").click();
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    await snap(page, "audition-edit-mode");
  });

  await test.step("play (interpreter): onTick rotation observable, onSelect click triggers audio + translation interpolation, pause/stop restores state", async () => {
    test.slow();
    await clickButtonSphereInViewport(page); // re-select ButtonSphere
    await setCamera(page); // selecting a node does not move the camera, but re-pin defensively before play-mode's own reframe-on-stop check later

    await expect(page.getByTestId("playbar.engine-picker")).toHaveValue("interpreter");
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
    await snap(page, "play-interpreter-started");

    // Regression coverage for the audio-host-keying bug: the Audition
    // gesture happened in the PRECEDING step, in edit mode, before
    // `history.freeze()` (DOC-031/DOC-045, run by startPlay() just above).
    // The WebAudioHost instance (and its now-running AudioContext) must
    // survive that freeze intact -- no new gesture here.
    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    await snap(page, "play-interpreter-audio-survived");

    // onTick continuously rewrites /nodes/2/rotation via the `angle` variable -- observable live in the overlay.
    const angleRow = page.getByTestId("viewport.play-overlay.variable.angle");
    const baseAngle = parseFloat(await readVal(angleRow));
    await page.waitForTimeout(400);
    await expect.poll(async () => parseFloat(await readVal(angleRow))).toBeGreaterThan(baseAngle);
    await snap(page, "play-interpreter-ticking");

    // Clicking ButtonSphere in the viewport during play mode routes to the running engine's
    // fireSelect (PC-008), not editor selection: it fires onSelect, toggling `toggled`,
    // interpolating TogglePillar's translation, and (the AudioContext now exists, from the
    // Audition click above) firing the audio-emitter "playing" trigger pointer -- a real,
    // audible voice.
    const toggledRow = page.getByTestId("viewport.play-overlay.variable.toggled");
    await expect(toggledRow).toHaveText(/false/);
    await clickButtonSphereInViewport(page);
    await expect(toggledRow).toHaveText(/true/, { timeout: 3000 });
    await expect.poll(() => audioDiagnostics(page)).toMatch(/last trigger: source 0/);
    await snap(page, "play-interpreter-select-audio");

    await page.getByTestId("playbar.pause").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "paused");
    const pausedAngle = await readVal(angleRow);
    await page.waitForTimeout(300);
    expect(await readVal(angleRow)).toBe(pausedAngle);
    await snap(page, "play-interpreter-paused");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
    await expect(page.getByTestId("viewport.play-overlay")).toHaveCount(0);
    await setCamera(page); // stop() reframes the camera on the restored scene -- re-pin before relying on dead-center click math again
    await clickButtonSphereInViewport(page);
    await expect(page.getByTestId("scene-tree.row.3")).toHaveClass(/selected/);
    await expect(page.getByTestId("inspector.transform.position-x")).toBeEnabled();
    await snap(page, "play-interpreter-stopped-restored");
  });

  await test.step('copilot: "spin when clicked" on ButtonSphere -> Accept -> graph nodes + history entry -> undo', async () => {
    test.slow();
    await page.getByTestId("right-panel.tab.copilot").click();
    await expect(page.getByTestId("copilot.panel")).toBeVisible();

    const before = await getGraphJson(page);
    const input = page.getByTestId("copilot.composer.input");
    await input.fill("spin when clicked");
    await page.getByTestId("copilot.composer.send").click();

    const { testId } = await lastProposalCard(page);
    await expect(page.getByTestId(`${testId}.badge.validation`)).toHaveText(/passed/i);
    await snap(page, "copilot-proposal");

    await page.getByTestId(`${testId}.accept`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Applied/);

    // The dropdown lists every entry ever pushed in order (UX-108), including
    // this session's earlier undone-then-not-redone steps (DOC-039) -- the
    // Copilot entry is simply the most recently pushed, i.e. the LAST one.
    const entries = await readHistoryEntries(page);
    expect(entries[entries.length - 1]).toMatch(/^Copilot: /);
    const afterAccept = await getGraphJson(page);
    expect(afterAccept.nodes.length).toBeGreaterThan(before.nodes.length);
    await snap(page, "copilot-accepted");

    await page.getByTestId("topbar.undo").click();
    const afterUndo = await getGraphJson(page);
    expect(afterUndo.nodes).toHaveLength(before.nodes.length);
    await snap(page, "copilot-undo");
  });

  await test.step("play (compiled): rotation observable through the transpiled engine too", async () => {
    test.slow();
    await page.getByTestId("playbar.engine-picker").selectOption("compiled");
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("locked-banner")).toHaveAttribute("data-play-state", "playing");

    const angleRow = page.getByTestId("viewport.play-overlay.variable.angle");
    const baseAngle = parseFloat(await readVal(angleRow));
    await page.waitForTimeout(400);
    await expect.poll(async () => parseFloat(await readVal(angleRow))).toBeGreaterThan(baseAngle);
    await snap(page, "play-compiled-ticking");

    await page.getByTestId("playbar.stop").click();
    await expect(page.getByTestId("locked-banner")).toHaveCount(0);
  });

  await test.step("export: captured download re-parses as a valid container, its graph validates, and the .glb byte-prefix is sane", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("topbar.export").click()]);
    // `.last()`: an earlier toast (e.g. the Copilot accept's "Applied: ...") can still be visible/
    // not-yet-auto-dismissed (UX-109's ~1.8s) when this one appears, so more than one `toast` testid
    // may be on screen at once -- the export toast is always the most recently added.
    await expect(page.getByTestId("toast").last()).toContainText("Export complete");
    const downloadPath = await download.path();
    const bytes = readFileSync(downloadPath!);

    // glTF binary header sanity: magic "glTF" (0x46546C67 LE) at byte 0, version 2 at byte 4.
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);

    const reparsed = parseContainer(new Uint8Array(bytes));
    expect(reparsed.kind).toBe("glb");
    const graph = (reparsed.json as { extensions: { KHR_interactivity: { graphs: unknown[] } } }).extensions.KHR_interactivity
      .graphs[0];
    expect(validateGraph(graph as VGraph).ok).toBe(true);
    await snap(page, "export-verified");
  });
});
