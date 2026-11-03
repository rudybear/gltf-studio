import { test, expect, type Page } from "@playwright/test";
import { NAN_FIXTURE_NAME, buildNanFixtureBytes } from "./nan-fixture.js";
import { waitForNodesSettled } from "./graph-canvas-test-helpers.js";

/**
 * specs/ux-graph-canvas.md UX-524: NaN literals (omitted `value`s — float
 * defaults are NaN) are shown explicitly, never silently become 0, never
 * produce an invalid color, never crash, and can be edited back to a number.
 * Fixture: e2e/nan-fixture.ts (omitted float4 color literal on a
 * baseColorFactor pointer/set, omitted float3 on /nodes/0/scale, omitted float
 * `a` on math/add, and float / float3 variables with no default).
 */

type RawGraph = {
  nodes: Array<{ values?: Record<string, { type?: number; value?: unknown[] }> }>;
  variables: Array<{ id?: string; value?: unknown[] }>;
};

async function importNanFixture(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("./");
  await page.setInputFiles('[data-testid="topbar.import-input"]', { name: NAN_FIXTURE_NAME, mimeType: "model/gltf-binary", buffer: buildNanFixtureBytes() });
  await expect(page.getByTestId("topbar.project-name")).toHaveText("nan-fixture");
  await expect(page.getByTestId("gcanvas.node.0")).toBeVisible();
  await waitForNodesSettled(page);
  return errors;
}

async function graph(page: Page): Promise<RawGraph> {
  const json = await page.evaluate(() => window.__gltfStudioGraphTest!.getDocumentJson());
  return (json as { extensions: { KHR_interactivity: { graphs: RawGraph[] } } }).extensions.KHR_interactivity.graphs[0]!;
}

test.describe("NaN literal UX (UX-524)", () => {
  test.describe.configure({ mode: "serial" });

  test("omitted float literals render as an explicit NaN placeholder and non-editable chips read NaN, with no page errors", async ({ page }) => {
    const errors = await importNanFixture(page);
    // Scalar float `a` on math/add (node 3): empty field + "NaN" placeholder; `b` = 1 stays a real number.
    const a = page.getByTestId("gcanvas.literal.3.a");
    await expect(a).toHaveValue("");
    await expect(a).toHaveAttribute("placeholder", "NaN");
    await expect(page.getByTestId("gcanvas.literal.3.b")).toHaveValue("1");
    // Color literal (node 1, baseColorFactor): numeric slots with NaN placeholders and NO fake white swatch.
    await expect(page.getByTestId("gcanvas.literal.1.value.swatch")).toHaveCount(0);
    for (const c of ["x", "y", "z", "w"]) {
      await expect(page.getByTestId(`gcanvas.literal.1.value.${c}`)).toHaveAttribute("placeholder", "NaN");
    }
    await expect(page.getByTestId("gcanvas.literal.1.value.init-color")).toBeVisible();
    // Non-editable float3 chip (node 4, /nodes/0/scale): "= [NaN, NaN, NaN]", not "= []".
    await expect(page.getByTestId("gcanvas.node.4")).toContainText("= [NaN, NaN, NaN]");
    expect(errors).toEqual([]);
  });

  test("focusing and blurring an untouched NaN field does not write 0; the omitted value stays omitted", async ({ page }) => {
    await importNanFixture(page);
    const a = page.getByTestId("gcanvas.literal.3.a");
    // focus() rather than click(): a click on a narrow empty number input can land on its spin button and step it to -1.
    await a.focus();
    await a.blur();
    await page.getByTestId("gcanvas.literal.1.value.x").focus();
    await page.getByTestId("gcanvas.literal.1.value.x").blur();
    const g = await graph(page);
    expect(g.nodes[3]!.values!.a).toEqual({ type: 0 });
    expect(g.nodes[1]!.values!.value).toEqual({ type: 2 });
    await expect(page.getByTestId("topbar.undo")).toBeDisabled();
  });

  test("a NaN scalar can be edited back to a number", async ({ page }) => {
    await importNanFixture(page);
    const a = page.getByTestId("gcanvas.literal.3.a");
    await a.fill("2.5");
    await a.blur();
    await expect.poll(async () => (await graph(page)).nodes[3]!.values!.a!.value).toEqual([2.5]);
  });

  test("a NaN color: editing one component keeps the rest NaN (not 0); the init-color button starts a real color", async ({ page }) => {
    await importNanFixture(page);
    const x = page.getByTestId("gcanvas.literal.1.value.x");
    await x.fill("0.5");
    await x.blur();
    await expect.poll(async () => (await graph(page)).nodes[1]!.values!.value!.value).toEqual([0.5, "NaN", "NaN", "NaN"]);
    // Still partly NaN -> still the numeric editor (no invalid-color swatch).
    await expect(page.getByTestId("gcanvas.literal.1.value.swatch")).toHaveCount(0);
    await page.getByTestId("gcanvas.literal.1.value.init-color").click();
    await expect.poll(async () => (await graph(page)).nodes[1]!.values!.value!.value).toEqual([1, 1, 1, 1]);
    const swatch = page.getByTestId("gcanvas.literal.1.value.swatch");
    await expect(swatch).toHaveValue("#ffffff");
  });

  test("Variables panel: float / float3 variables with no default show NaN placeholders and survive focus+blur untouched", async ({ page }) => {
    await importNanFixture(page);
    await page.getByTestId("gcanvas.variables.expand").click();
    const f = page.getByTestId("gcanvas.variables.default.0.editor");
    await expect(f).toHaveAttribute("placeholder", "NaN");
    for (const c of ["x", "y", "z"]) {
      await expect(page.getByTestId(`gcanvas.variables.default.1.editor.${c}`)).toHaveAttribute("placeholder", "NaN");
    }
    await f.focus();
    await f.blur();
    expect((await graph(page)).variables[0]!.value).toBeUndefined();
    await f.fill("7");
    await f.blur();
    await expect.poll(async () => (await graph(page)).variables[0]!.value).toEqual([7]);
  });

  test("Play on a NaN graph shows NaN in the overlay (no crash)", async ({ page }) => {
    const errors = await importNanFixture(page);
    await page.getByTestId("playbar.play").click();
    await expect(page.getByTestId("viewport.play-overlay")).toBeVisible();
    await expect(page.getByTestId("viewport.play-overlay.variable.f").locator(".val")).toHaveText("NaN");
    await expect(page.getByTestId("viewport.play-overlay.variable.v3").locator(".val")).toHaveText("[NaN, NaN, NaN]");
    expect(errors).toEqual([]);
  });
});
