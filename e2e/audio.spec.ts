import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_GLB_PATH, FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL } from "./global-setup.js";
import { buildInspectorFixtureBytes, INSPECTOR_FIXTURE_NAME } from "./inspector-fixture.js";
import { buildAudioGraphInvalidFixtureBytes, AUDIO_GRAPH_INVALID_FIXTURE_NAME, AUDIO_GRAPH_CYCLE_NODE_LABELS } from "./audio-graph-invalid-fixture.js";

/**
 * M7 audio (specs/engine-api.md AH-001/AH-002/AGH-001, specs/ux-audio-graph.md
 * UX-600..607, specs/ux-inspector.md UX-406): the inspector's real Audition
 * control (gesture-gated `AudioHost.init()`) and the Audio graph dock tab
 * (`@gltf-studio/audio-canvas`'s read-only canvas + lint banner).
 */

async function importFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
  await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
}

function audioDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => window.__gltfStudioAudioTest?.diagnostics() ?? "no hook");
}

test.describe("audio: Audition control (specs/ux-inspector.md UX-406, AH-001/AH-002)", () => {
  test("audition click creates the AudioContext only after the gesture, and it ends up running with an active voice", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('[data-testid="topbar.import-input"]', {
      name: INSPECTOR_FIXTURE_NAME,
      mimeType: "model/gltf-binary",
      buffer: buildInspectorFixtureBytes()
    });
    await expect(page.getByTestId("topbar.project-name")).toHaveText("inspector-fixture");

    // Before ANY gesture: WebAudioHost.loadEmitters already ran (App.tsx's
    // per-document effect), but AH-001 forbids creating the AudioContext
    // before a gesture — diagnostics() must read "idle".
    await expect.poll(() => audioDiagnostics(page)).toBe("audio idle");

    await page.getByTestId("scene-tree.row.4").click(); // "Speaker"
    await expect(page.getByTestId("inspector.audio.audition")).toBeEnabled();

    // The click IS the AH-001 gesture.
    await page.getByTestId("inspector.audio.audition").click();

    await expect.poll(() => audioDiagnostics(page)).toContain("running");
    const diagnostics = await audioDiagnostics(page);
    expect(diagnostics).toContain("1 emitter");
  });
});

test.describe("audio: Audio graph dock tab (specs/ux-audio-graph.md UX-6xx, AGH-001)", () => {
  test("renders the graph's real nodes with no lint banner for a valid bufferSource -> gain -> emitter chain (UX-600/UX-601)", async ({ page }) => {
    await importFixture(page);
    await page.getByTestId("dock.tab.audio-graph").click();
    await expect(page.getByTestId("acanvas.root")).toBeVisible();
    await expect(page.getByTestId("acanvas.lint-banner")).toHaveCount(0);
    // The gain node from global-setup.ts's KHR_audio_graph chain, plus the
    // synthesized source + terminal emitter node (map-audio-graph.ts) — 3
    // nodes total for this one-processing-node chain. Scoped to
    // `acanvas.root`: OpNode (shared with the behavior-graph canvas, per
    // UX-600) keeps its `gcanvas.node.*` testid regardless of which canvas
    // renders it, and the Behavior graph tab stays mounted-but-hidden
    // alongside this one (UX-103), so an unscoped locator would also match
    // ITS nodes.
    const audioCanvas = page.getByTestId("acanvas.root");
    await expect(audioCanvas.locator('[data-testid^="gcanvas.node."]')).toHaveCount(3);
    const gainNode = audioCanvas.locator('[data-testid^="gcanvas.node."]', { hasText: FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL });
    await expect(gainNode).toBeVisible();
  });

  test("shows a lint banner naming the actual cycle path for an invalid graph, and dashes the offending edges (UX-602/UX-603)", async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('[data-testid="topbar.import-input"]', {
      name: AUDIO_GRAPH_INVALID_FIXTURE_NAME,
      mimeType: "model/gltf-binary",
      buffer: buildAudioGraphInvalidFixtureBytes()
    });
    await expect(page.getByTestId("topbar.project-name")).toHaveText("audio-graph-invalid-fixture");

    await page.getByTestId("dock.tab.audio-graph").click();
    await expect(page.getByTestId("acanvas.lint-banner")).toBeVisible();
    const bannerText = await page.getByTestId("acanvas.lint-banner").innerText();
    expect(bannerText).toContain(AUDIO_GRAPH_CYCLE_NODE_LABELS[0]);
    expect(bannerText).toContain(AUDIO_GRAPH_CYCLE_NODE_LABELS[1]);
    expect(bannerText.toLowerCase()).toContain("cycle");

    // UX-603: the cycle's edges are drawn dashed (not hidden) — React Flow
    // applies `MappedEdge.invalid`'s resulting `strokeDasharray` as an
    // inline style, not a literal SVG attribute, hence the `style*=` match.
    const dashedEdges = page.locator('.react-flow__edge path[style*="stroke-dasharray"]');
    await expect(dashedEdges).toHaveCount(2);
  });
});
