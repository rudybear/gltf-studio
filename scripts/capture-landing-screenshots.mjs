// Captures the two real-app screenshots the landing page (`/site/`) and the
// README embed — never hand-drawn mockups, the actual built app rendering
// the actual R4 Racer sample, driven the same way e2e/racer.spec.ts and
// e2e/script.spec.ts already drive it (same testids, same load sequence).
//
// Run against a BUILT app (`pnpm build` first, same convention as
// `pnpm e2e` / playwright.config.ts): starts its own `vite preview` on a
// scratch port so it doesn't collide with a concurrently-running e2e
// server, waits for real content (366 graph nodes / real decompiled code),
// and writes two PNGs to docs/media/ before shutting the server down.
//
// Usage: pnpm build && node scripts/capture-landing-screenshots.mjs
//
// Writes PNGs; the committed docs/media/*.webp files are those PNGs
// re-encoded to WebP afterward (no image-compression library is an actual
// project dependency, so this is a manual one-off rather than a step this
// script performs itself) — e.g. `python3 -c "from PIL import Image;
// Image.open('racer-behavior-graph.png').convert('RGB').save(
// 'racer-behavior-graph.webp', 'WEBP', quality=82)"`, keeping the landing
// page's total payload well under its size budget (see /site/index.html's
// own note).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const mediaDir = resolve(repoRoot, "docs/media");
const PORT = 4174; // distinct from playwright.config.ts's e2e port (4173)
const BASE_URL = `http://localhost:${PORT}/app/`;

mkdirSync(mediaDir, { recursive: true });

function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolvePromise(undefined);
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${url}`));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function main() {
  console.log("[capture-landing-screenshots] starting vite preview...");
  // Invoke vite directly rather than through `pnpm run preview -- --port
  // ...`: the pnpm shim in this environment does not reliably forward args
  // placed after `--` down to the underlying script (observed directly —
  // the port flag was silently dropped and vite fell back to
  // vite.config.ts's own default, `--strictPort` and all), so this uses
  // the app package's own installed vite binary instead.
  const viteBin = resolve(repoRoot, "packages/app/node_modules/vite/bin/vite.js");
  const server = spawn("node", [viteBin, "preview", "--port", String(PORT), "--strictPort"], {
    cwd: resolve(repoRoot, "packages/app"),
    stdio: "inherit"
  });
  const cleanup = () => server.kill();
  process.on("exit", cleanup);

  try {
    await waitForServer(BASE_URL);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.goto(BASE_URL);

    // Dismiss the first-visit tour banner — a marketing screenshot should
    // show the editor itself, not an onboarding nudge.
    const tourBanner = page.getByTestId("tour.banner.dismiss");
    if (await tourBanner.isVisible().catch(() => false)) await tourBanner.click();

    // Enlarge the bottom dock (drag its resize handle up) BEFORE loading a
    // document — graph-view.tsx's `fitView` runs once, synchronously, on the
    // Behavior graph panel's first-ever non-zero-size layout (a documented
    // bug-fix seam, see that file's own comment) and deliberately never
    // re-fits on a later resize (so a real user's own pan/zoom survives a
    // tab-away-and-back). Resizing after the graph is already mounted would
    // leave it fit to the OLD, smaller box; resizing first means the panel's
    // first real layout — once R4 Racer loads below — already happens at
    // the enlarged size.
    const handle = page.getByTestId("dock.resize-handle");
    const handleBox = await handle.boundingBox();
    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 260, { steps: 10 });
      await page.mouse.up();
    }

    console.log("[capture-landing-screenshots] loading R4 Racer from the starter gallery...");
    await page.getByTestId("viewport.gallery.card.racer.load").click();
    await expectVisible(page, "topbar.project-name");

    // Screenshot 1: behavior-graph tab, real 366-node graph laid out.
    await page.getByTestId("dock.tab.graph").click();
    await page.locator('[data-testid^="gcanvas.node."]').first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="gcanvas.node."]').length === 366,
      { timeout: 30_000 }
    );
    // Collapse the node palette so the canvas itself — the actual graph — is
    // what fills the frame, rather than the search/ops list.
    await page.getByTestId("gcanvas.palette.toggle").click();
    await page.waitForTimeout(300);

    // graph-view.tsx's `fitView` runs once, synchronously, on this panel's
    // first-ever non-zero-size layout and deliberately never re-fits after
    // (a documented bug-fix seam preserving a real user's own pan/zoom
    // across a tab-away-and-back) — so at this 366-node scale it leaves the
    // canvas panned/zoomed to whatever that first layout pass happened to
    // compute, cropped by the ReactFlow pane's own default `minZoom`/
    // `maxZoom` clamp, not a clean fit of the whole graph. A literal
    // full-graph fit wouldn't help anyway: ELK's layered layout for 366
    // nodes spans a bounding box roughly 27000x6000 (measured), so fitting
    // all of it turns every node to illegible dust. Instead: every node's
    // DOM element exists regardless of visibility
    // (`onlyRenderVisibleElements` isn't set), so read every node's screen
    // rect, invert the pane's current CSS transform (`translate(x,y)
    // scale(zoom)`, exactly React Flow's own viewport convention — the
    // same one the test-only `setViewport` seam e2e/graph-canvas.spec.ts
    // uses takes) to get each node's FLOW-space center, and set a moderate
    // fixed zoom centered on the MEAN of those centers (not the bounding
    // box's own midpoint, which for a widely-branching layout can land in
    // an empty gap between islands rather than inside a dense cluster) —
    // real node cards, real connections, still visibly a lot of them.
    const fitViewport = await page.evaluate(() => {
      const pane = document.querySelector(".gcanvas-canvas-inner");
      const viewportEl = document.querySelector(".react-flow__viewport");
      const nodeEls = Array.from(document.querySelectorAll('[data-testid^="gcanvas.node."]'));
      if (!pane || !viewportEl || nodeEls.length === 0) return null;

      const transform = getComputedStyle(viewportEl).transform; // matrix(currentZoom, 0, 0, currentZoom, tx, ty)
      const m = new DOMMatrixReadOnly(transform);
      const currentZoom = m.a;
      const paneRect = pane.getBoundingClientRect();

      let sumX = 0, sumY = 0;
      for (const el of nodeEls) {
        const r = el.getBoundingClientRect();
        sumX += (r.left + r.width / 2 - paneRect.left - m.e) / currentZoom;
        sumY += (r.top + r.height / 2 - paneRect.top - m.f) / currentZoom;
      }
      const centerX = sumX / nodeEls.length;
      const centerY = sumY / nodeEls.length;
      const zoom = 0.35;
      // React Flow's viewport {x,y} is the pane-space translation, i.e. the
      // screen position of flow-origin (0,0) — to center (centerX,centerY)
      // in the pane, translate by (paneCenter - center*zoom).
      const x = paneRect.width / 2 - centerX * zoom;
      const y = paneRect.height / 2 - centerY * zoom;
      return { x, y, zoom };
    });
    if (fitViewport) {
      await page.evaluate((vp) => window.__gltfStudioGraphCanvasTest?.setViewport(vp), fitViewport);
    }
    await page.waitForTimeout(300); // let the pan/zoom settle visually before the shot
    await page.screenshot({ path: resolve(mediaDir, "racer-behavior-graph.png") });
    console.log("[capture-landing-screenshots] wrote docs/media/racer-behavior-graph.png");

    // Screenshot 2: script tab, decompiled TypeScript with the EQUIV badge.
    await page.getByTestId("dock.tab.script").click();
    await expectVisible(page, "script.panel");
    await page.waitForFunction(
      () => (window.__gltfStudioScriptTest?.getCode() ?? "").includes("rt.onTick("),
      { timeout: 30_000 }
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(mediaDir, "racer-script-equiv.png") });
    console.log("[capture-landing-screenshots] wrote docs/media/racer-script-equiv.png");

    await browser.close();
  } finally {
    cleanup();
  }
}

async function expectVisible(page, testId) {
  await page.getByTestId(testId).waitFor({ state: "visible", timeout: 15_000 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
