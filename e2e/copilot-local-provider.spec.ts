import { test, expect, type Page, type Route } from "@playwright/test";
import { FIXTURE_GLB_PATH } from "./global-setup.js";

/**
 * Local-model (OpenAI-compatible) Copilot provider e2e coverage
 * (specs/agent-service.md AG-017..AG-022, specs/ux-settings.md
 * UX-1300..1305, specs/ux-copilot.md UX-1012, specs/ux-shell.md UX-129,
 * docs/adr/0005-local-openai-compatible-llm-provider.md): the settings
 * dialog's provider selection + local-endpoint configuration, "Test
 * connection"'s ok/cors-blocked outcomes (AG-021), a full prompt -> stubbed
 * tool-call -> proposal -> Accept -> undo round trip against a REAL document
 * (mirroring e2e/copilot.spec.ts's own mock-provider "spin it on click"
 * test), and the AG-022/UX-1303 default-to-Mock guarantee.
 *
 * No real model/GPU is ever involved: the local endpoint's HTTP surface
 * (`GET /v1/models`, `POST /v1/chat/completions`) is entirely stubbed via
 * `page.route()`. Because the stubbed base URL is genuinely on a different
 * port than the app's own origin (http://localhost:4173/app/, per
 * playwright.config.ts), every one of these requests is a REAL cross-origin
 * fetch the browser actually CORS-checks -- the "ok" tests attach a real
 * `access-control-allow-origin` header so the browser lets the page read the
 * response; the CORS-blocked test deliberately omits it so the browser's own
 * CORS enforcement (not a faked status string) produces the TypeError
 * connection-test.ts's `probeNoCors` disambiguation path is built to handle.
 *
 * Reuses e2e/copilot.spec.ts's fixture/helpers verbatim where possible
 * (`importFixture`, `switchToCopilotTab`, `sendPrompt`, `lastProposalCard`,
 * `readHistoryEntries`, `getGraphJson` via `window.__gltfStudioGraphTest`)
 * -- see that file's own header for the fixture's exact shape (2-node
 * KHR_interactivity graph, scene-tree row 1 = "Widget", node index 1).
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

async function lastProposalCard(page: Page): Promise<{ card: ReturnType<Page["locator"]>; testId: string }> {
  const card = page.locator(".copilot-proposal-card").last();
  await expect(card).toBeVisible({ timeout: 10000 });
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("proposal card is missing its data-testid");
  return { card, testId };
}

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

/** Opens the settings dialog and configures the local provider -- does NOT close the dialog (callers close it, or leave it open, per their own test's needs). */
/** UX-1301: the provider select itself -- switching it to "local" reveals the base-url/model/api-key/test-connection fields the rest of this helper drives. */
async function openSettingsAndSelectLocal(page: Page, baseUrl: string, model = "test-model"): Promise<void> {
  await page.getByTestId("topbar.settings").click();
  await expect(page.getByTestId("settings.dialog")).toBeVisible();
  await page.getByTestId("settings.provider-select").selectOption("local");
  await expect(page.getByTestId("settings.provider-select")).toHaveValue("local");
  await page.getByTestId("settings.base-url").fill(baseUrl);
  // `settings.model` renders as a plain text <input> until fetch-models/test-connection populates `models` (UX-1302) -- neither test calls those before this fill, so it's always the input here.
  await page.getByTestId("settings.model").fill(model);
}

/**
 * Fulfills a `page.route()` match with a real CORS-enabled JSON response,
 * transparently answering the browser's own CORS preflight (an `OPTIONS`
 * request) for any route whose real request isn't a CORS-simple request --
 * `POST /v1/chat/completions` always carries a `Content-Type: application/
 * json` header (request-builder.ts), which is NOT one of the fetch spec's
 * simple-request content types, so it always triggers a preflight before
 * the browser will even attempt the real POST. `GET /v1/models` (no custom
 * headers in these tests) never triggers one, so this also just works for
 * that simpler case.
 */
async function fulfillWithCors(route: Route, body: unknown): Promise<void> {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization"
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  await route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: JSON.stringify(body) });
}

/** Ollama-shaped chat/completions response (matches packages/agent-llm/src/openai-compatible-agent-provider.test.ts's own `ollamaShapedSpinResponse` fixture envelope) whose single tool call is a `spin_node_on_event` targeting node 1, event/onSelect, y axis, 90deg/s. */
function stubSpinToolCallResponse() {
  return {
    id: "chatcmpl-e2e-stub-1",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "spin_node_on_event",
                arguments: JSON.stringify({ nodeIndex: 1, eventOp: "event/onSelect", axis: "y", degreesPerSecond: 90 })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}

const STUB_PORT = 11491;
const STUB_BASE_URL = `http://localhost:${STUB_PORT}/v1`;

test.describe("Copilot: local OpenAI-compatible provider (specs/agent-service.md AG-017..AG-022, specs/ux-settings.md UX-1300..1305)", () => {
  test("Test connection succeeds against a stubbed, CORS-enabled local endpoint (AG-021/UX-1304)", async ({ page }) => {
    await page.route(`${STUB_BASE_URL}/models`, (route) => fulfillWithCors(route, { data: [{ id: "test-model" }] }));

    await importFixture(page);
    await openSettingsAndSelectLocal(page, STUB_BASE_URL, "test-model");

    await page.getByTestId("settings.test-connection").click();
    const result = page.getByTestId("settings.test-result");
    await expect(result).toBeVisible();
    await expect(result).toHaveClass(/settings-test-result--ok/);
    await expect(result).toContainText(/connected/i);

    // UX-1305: the static CORS/hosted-demo guidance is always present in the
    // dialog (not conditional on this or any test-connection outcome).
    await expect(page.getByTestId("settings.cors-help")).toContainText(/CORS/i);
  });

  test('local provider: prompt -> stubbed tool call -> proposal card -> Accept adds graph nodes as ONE history entry; undo removes it (UX-1012)', async ({
    page
  }) => {
    test.slow();
    await page.route(`${STUB_BASE_URL}/chat/completions`, (route) => fulfillWithCors(route, stubSpinToolCallResponse()));

    await importFixture(page);
    await openSettingsAndSelectLocal(page, STUB_BASE_URL, "test-model");
    await page.getByTestId("settings.close-x").click();
    await expect(page.getByTestId("settings.dialog")).toHaveCount(0);

    await page.getByTestId("scene-tree.row.1").click(); // "Widget" (node 1) -- same node e2e/copilot.spec.ts's mock spin test uses.
    await switchToCopilotTab(page);

    // UX-1012: the provider indicator now names the local provider, not Mock.
    await expect(page.getByTestId("copilot.provider-indicator")).toContainText(/local/i);
    await expect(page.getByTestId("copilot.provider-indicator")).not.toContainText(/^Provider: Mock$/);

    const before = await getGraphJson(page);
    expect(before.nodes).toHaveLength(2);

    await sendPrompt(page, "spin the selected node when clicked");
    const { testId } = await lastProposalCard(page);

    await expect(page.getByTestId(`${testId}.badge.validation`)).toHaveText(/passed/i);
    await expect(page.getByTestId(`${testId}.badge.commands`)).toHaveText(/\d+ commands?/i);

    await expect(page.getByTestId(`${testId}.commands`)).toHaveCount(0);
    await page.getByTestId(`${testId}.toggle`).click();
    await expect(page.getByTestId(`${testId}.commands`)).toBeVisible();
    await expect(page.getByTestId(`${testId}.commands`).locator("li").first()).not.toBeEmpty();
    await page.getByTestId(`${testId}.toggle`).click();
    await expect(page.getByTestId(`${testId}.commands`)).toHaveCount(0);

    await page.getByTestId(`${testId}.accept`).click();
    await expect(page.getByTestId(`${testId}.status`)).toHaveText(/Applied/);

    const entries = await readHistoryEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^Copilot: /);

    // packages/agent-llm/src/tool-handlers.ts's handleSpinNodeOnEvent pushes
    // exactly the same two new graph nodes (in the same order) as
    // packages/agent-mock's spin template: an event/onSelect trigger node,
    // then a pointer/interpolate action node -- matching e2e/copilot.spec.ts's
    // own mock-provider spin test's exact shape.
    const afterAccept = await getGraphJson(page);
    expect(afterAccept.nodes).toHaveLength(4);
    expect(afterAccept.declarations[afterAccept.nodes[2]!.declaration]!.op).toBe("event/onSelect");
    expect(afterAccept.declarations[afterAccept.nodes[3]!.declaration]!.op).toBe("pointer/interpolate");

    await expect(page.getByTestId("topbar.undo")).toBeEnabled();
    await page.getByTestId("topbar.undo").click();

    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
    const afterUndo = await getGraphJson(page);
    expect(afterUndo.nodes).toHaveLength(2);
  });

  test("a genuine (browser-enforced) CORS block surfaces the settings dialog's cors-blocked guidance (AG-021/UX-1304)", async ({ page }) => {
    // Verified empirically, in two stages:
    //
    // 1. Fulfilling a `page.route()` match WITHOUT an
    //    access-control-allow-origin header does NOT reproduce a real CORS
    //    block here -- a route.fulfill()'d response is not subject to
    //    Chromium's actual CORS enforcement (the "cors"-mode GET reads it
    //    successfully regardless of response headers), so the naive
    //    "just omit the header" approach from this task's own brief doesn't
    //    work as reasoned.
    // 2. The brief's suggested fallback -- branching on the real
    //    `sec-fetch-mode` request header Chromium attaches -- ALSO doesn't
    //    work: a debug probe showed Playwright's intercepted
    //    `route.request().headers()` doesn't include `sec-fetch-mode` at all
    //    (Chromium's CDP request-interception headers omit Fetch metadata
    //    headers), so both the primary GET and the no-cors POST probe
    //    reported no such header and both got the same treatment.
    //
    // What actually works: distinguish by HTTP METHOD instead, which is
    // real and inherent to the two call sites, not a browser-exposed
    // artifact -- network.ts's `testLocalEndpointConnection` always GETs
    // (`mode: "cors"`), while its `probeNoCors` retry always POSTs the SAME
    // url (`mode: "no-cors"`, see network.ts:33). So: `route.abort()` the
    // GET (a real network-level failure -> `fetch` rejects with a
    // TypeError, exactly what a genuine CORS block also throws) and
    // `route.fulfill()` the POST (so it resolves, as a no-cors request to a
    // real, listening-but-blocking server would).
    await page.route(`${STUB_BASE_URL}/models`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
      } else {
        await route.abort("failed");
      }
    });

    await importFixture(page);
    await openSettingsAndSelectLocal(page, STUB_BASE_URL, "test-model");

    await page.getByTestId("settings.test-connection").click();
    const result = page.getByTestId("settings.test-result");
    await expect(result).toBeVisible();
    await expect(result).toHaveClass(/settings-test-result--cors-blocked/);
    await expect(result).toContainText(/CORS/);
    await expect(result).toContainText(/OLLAMA_ORIGINS/);
  });

  test("provider defaults to Mock on a fresh load, with no settings interaction (AG-022/UX-1303)", async ({ page }) => {
    await importFixture(page);
    await switchToCopilotTab(page);

    await expect(page.getByTestId("copilot.provider-indicator")).toContainText(/^Provider: Mock/);

    await page.getByTestId("topbar.settings").click();
    await expect(page.getByTestId("settings.dialog")).toBeVisible();
    await expect(page.getByTestId("settings.provider-select")).toHaveValue("mock");
  });
});
