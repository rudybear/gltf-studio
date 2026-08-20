import { test, expect } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * REAL-model end-to-end proof (specs/agent-service.md AG-017..AG-022,
 * docs/adr/0005): drives the BUILT app in a real browser against a REAL
 * OpenAI-compatible endpoint (Ollama by default) -- no `page.route()`
 * stubbing anywhere in this file. This is the browser-side counterpart to
 * scripts/ai-smoke.mjs's node-side prompt matrix: settings -> local model ->
 * real HTTP round trip -> real proposal -> Accept -> a real interactivity-
 * graph node exists in the document.
 *
 * SKIPPED unless GLTFI_LLM_LIVE=1 -- it makes real network calls to a real
 * model server and is not part of `pnpm e2e`/CI (no GPU there, and this
 * spec's pass/fail depends on a live model's judgment, not a fixed stub).
 * Run it with:
 *
 *   GLTFI_LLM_LIVE=1 pnpm build && GLTFI_LLM_LIVE=1 pnpm exec playwright test e2e/copilot-live-model.spec.ts
 *
 * GLTFI_LLM_BASE_URL / GLTFI_LLM_MODEL override the endpoint/model (default:
 * http://localhost:11434/v1 / gemma4:26b -- gemma4:26b recommended per
 * scripts/ai-smoke.mjs's matrix results: matched the larger models'
 * accept/refuse pattern on every prompt tested while responding roughly
 * 25-50x faster once warm, see specs/agent-service.md's AG-017..AG-022
 * section for the full comparison).
 */

const BASE_URL = process.env.GLTFI_LLM_BASE_URL ?? "http://localhost:11434/v1";
const MODEL = process.env.GLTFI_LLM_MODEL ?? "gemma4:26b";

test.describe("Copilot: REAL local-model end-to-end proof (env-gated, not part of CI)", () => {
  test.skip(!process.env.GLTFI_LLM_LIVE, "set GLTFI_LLM_LIVE=1 to run this against a real local model server");
  test.slow(); // a real model's cold load + inference can take well over Playwright's default 30s.

  test("settings -> real local model -> real proposal -> Accept adds a graph node", async ({ page }) => {
    await page.goto("./");
    await page.setInputFiles('[data-testid="topbar.import-input"]', FIXTURE_GLB_PATH);
    await expect(page.getByTestId("topbar.project-name")).toHaveText("simple-scene");
    await page.waitForFunction(() => window.__gltfStudioGraphTest !== undefined);

    await page.getByTestId("topbar.settings").click();
    await expect(page.getByTestId("settings.dialog")).toBeVisible();
    await page.getByTestId("settings.provider-select").selectOption("local");
    await page.getByTestId("settings.base-url").fill(BASE_URL);
    await page.getByTestId("settings.model").fill(MODEL);

    // A real "Test connection" round trip against the real endpoint --
    // proves the browser's own CORS enforcement (not a stub) lets this
    // origin read the response, per this task's CORS investigation
    // (specs/ux-settings.md UX-1304/UX-1305, docs/adr/0005's Consequences).
    await page.getByTestId("settings.test-connection").click();
    await expect(page.getByTestId("settings.test-result")).toHaveClass(/settings-test-result--ok/, { timeout: 20000 });

    await page.getByTestId("settings.close-x").click();
    await expect(page.getByTestId("settings.dialog")).toHaveCount(0);

    await page.getByTestId("scene-tree.row.1").click(); // "Widget" (node 1) -- same node e2e/copilot.spec.ts's mock spin test uses.
    await page.getByTestId("right-panel.tab.copilot").click();
    await expect(page.getByTestId("copilot.panel")).toBeVisible();
    await expect(page.getByTestId("copilot.provider-indicator")).toContainText(/local/i);

    const before = await page.evaluate(() => {
      const json = window.__gltfStudioGraphTest!.getDocumentJson() as {
        extensions: { KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> } };
      };
      return json.extensions.KHR_interactivity?.graphs[0]?.nodes.length ?? 0;
    });

    await page.getByTestId("copilot.composer.input").fill("spin the selected node when clicked");
    await page.getByTestId("copilot.composer.send").click();

    const card = page.locator(".copilot-proposal-card").last();
    await expect(card).toBeVisible({ timeout: 60000 }); // real inference, not a stub -- generous timeout.
    const testId = await card.getAttribute("data-testid");
    if (!testId) throw new Error("proposal card is missing its data-testid");

    await expect(page.getByTestId(`${testId}.badge.validation`)).toHaveText(/passed/i);
    await page.getByTestId(`${testId}.accept`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Applied/);

    const after = await page.evaluate(() => {
      const json = window.__gltfStudioGraphTest!.getDocumentJson() as {
        extensions: { KHR_interactivity?: { graphs: Array<{ nodes: unknown[] }> } };
      };
      return json.extensions.KHR_interactivity?.graphs[0]?.nodes.length ?? 0;
    });
    expect(after).toBeGreaterThan(before);
  });
});
