// Visual (real-pixel) assertion helpers — the missing layer this program's
// e2e suite learned it needed the hard way: a dock tab whose content
// collapses to a sliver at mount time (the Script tab's `.script-tab-wrap`
// CSS-collapse bug, and the Behavior graph tab's hidden-mount `fitView`
// bug — see specs/ux-shell.md's and specs/ux-graph-canvas.md's bug-fix
// notes) can still pass every DOM/API-level assertion an e2e test writes
// (Monaco's own model text via `getCode()`, `toBeVisible()`, `getBoundingClientRect()`
// on an ancestor with a real height even though a *descendant* collapsed) — none of
// those observe what a user's screen would actually SHOW. These helpers
// screenshot a real `Locator` (the actual composited pixels Playwright's
// CDP screenshot API captures, not a DOM measurement or a rasterize-the-DOM
// shim) and check that non-trivial content is genuinely rendered.
import { PNG } from "pngjs";
import { expect, type Locator } from "@playwright/test";

export type PixelStats = {
  width: number;
  height: number;
  /** Pixels differing from the sampled background color by more than the tolerance. */
  nonBackgroundCount: number;
  nonBackgroundFraction: number;
  /** Bounding box (in screenshot-local pixel coordinates) of all non-background pixels, or null if none. */
  inkBoundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

/**
 * Decodes a screenshot PNG buffer and computes how many pixels differ from
 * the image's own background color (sampled from its four edges — robust
 * against an image whose single most-common pixel overall is actually a
 * syntax-highlighting color rather than the real backdrop) by more than
 * `tolerance` per RGB channel, plus the bounding box of those pixels.
 */
export function analyzeScreenshot(buffer: Buffer, tolerance = 24): PixelStats {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  const edgeColorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();
  const sampleEdge = (x: number, y: number) => {
    const idx = (width * y + x) << 2;
    const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
    const entry = edgeColorCounts.get(key);
    if (entry) entry.count++;
    else edgeColorCounts.set(key, { count: 1, r: data[idx], g: data[idx + 1], b: data[idx + 2] });
  };
  for (let x = 0; x < width; x++) {
    sampleEdge(x, 0);
    sampleEdge(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sampleEdge(0, y);
    sampleEdge(width - 1, y);
  }
  let background = { r: 0, g: 0, b: 0 };
  let backgroundCount = -1;
  for (const entry of edgeColorCounts.values()) {
    if (entry.count > backgroundCount) {
      backgroundCount = entry.count;
      background = entry;
    }
  }

  let nonBackgroundCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const dr = Math.abs(data[idx] - background.r);
      const dg = Math.abs(data[idx + 1] - background.g);
      const db = Math.abs(data[idx + 2] - background.b);
      if (dr > tolerance || dg > tolerance || db > tolerance) {
        nonBackgroundCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    width,
    height,
    nonBackgroundCount,
    nonBackgroundFraction: nonBackgroundCount / (width * height),
    inkBoundingBox: nonBackgroundCount > 0 ? { minX, minY, maxX, maxY } : null
  };
}

/**
 * Screenshots `locator` and asserts it actually rendered non-trivial
 * visible content, i.e. genuinely non-background pixels in real
 * proportion to the region's own size — not merely that the element
 * exists/`toBeVisible()`/has a non-zero `boundingBox()`, all of which a
 * hidden-mount-then-shown sizing bug can still satisfy for a container
 * whose actual rendered content is a sliver or nothing (this program's own
 * bug history: `e2e/script.spec.ts` originally only ever checked Monaco's
 * model text via `getCode()`).
 */
export async function assertRegionRendersContent(
  locator: Locator,
  opts: { minNonBackgroundPixels?: number; minNonBackgroundFraction?: number } = {}
): Promise<PixelStats> {
  const buffer = await locator.screenshot();
  const stats = analyzeScreenshot(buffer);
  const minCount = opts.minNonBackgroundPixels ?? 300;
  const minFraction = opts.minNonBackgroundFraction ?? 0.01;
  expect(
    stats.nonBackgroundCount,
    `expected at least ${minCount} non-background pixels in a ${stats.width}x${stats.height} screenshot of this region, saw ${stats.nonBackgroundCount} (${(stats.nonBackgroundFraction * 100).toFixed(2)}%) — the region rendered essentially nothing`
  ).toBeGreaterThanOrEqual(minCount);
  expect(stats.nonBackgroundFraction).toBeGreaterThanOrEqual(minFraction);
  return stats;
}

/**
 * The Script tab's own specific failure mode was subtler than "rendered
 * nothing": a single clipped line of text at the very top of an otherwise-
 * blank container still has plenty of "some pixels rendered" — the tell was
 * that the rendered content's vertical extent never grew past ~one line no
 * matter the dock's actual height. This asserts the ink bounding box's own
 * height clears `minSpanPx` (default comfortably above one Monaco line at
 * this app's 12px font / ~18-19px line height, comfortably below what even
 * a badly-shrunk-but-still-multi-line editor would show).
 */
/** The buffer's average RGB — a cheap, tolerant-of-anti-aliasing summary of "what color is this region, roughly," good enough to tell two visually-distinct regions (e.g. a decorated line vs. a plain one) apart without needing exact-pixel matching. */
export function averageColor(buffer: Buffer): { r: number; g: number; b: number } {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const n = width * height;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const idx = i << 2;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
  }
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Screenshots two locators/regions and asserts their average colors differ
 * by at least `minDelta` (summed absolute per-channel difference) — the
 * pixel-level version of "these two things don't look the same," used by
 * script-panel jump-highlight coverage to confirm a decorated line's row of
 * pixels is genuinely visually distinct from an undecorated one (rather
 * than merely that SOME selection API reports a range, per this bug
 * report's own root cause: an api-level assertion can pass while a real
 * screen shows nothing different at all).
 */
export async function assertRegionsVisuallyDiffer(a: Buffer, b: Buffer, minDelta = 12): Promise<void> {
  const colorA = averageColor(a);
  const colorB = averageColor(b);
  const delta = Math.abs(colorA.r - colorB.r) + Math.abs(colorA.g - colorB.g) + Math.abs(colorA.b - colorB.b);
  expect(
    delta,
    `expected two regions' average colors to differ by at least ${minDelta} (combined RGB delta), saw ${delta.toFixed(1)} (A=${JSON.stringify(colorA)}, B=${JSON.stringify(colorB)})`
  ).toBeGreaterThanOrEqual(minDelta);
}

export async function assertRegionSpansMultipleLines(locator: Locator, minSpanPx = 55): Promise<PixelStats> {
  const buffer = await locator.screenshot();
  const stats = analyzeScreenshot(buffer);
  expect(stats.inkBoundingBox, "expected the region to render some non-background content at all").not.toBeNull();
  const span = stats.inkBoundingBox!.maxY - stats.inkBoundingBox!.minY;
  expect(
    span,
    `expected rendered content's vertical extent to exceed ${minSpanPx}px (a single-line collapse renders roughly 15-20px regardless of container height), saw ${span}px in a ${stats.height}px-tall region`
  ).toBeGreaterThanOrEqual(minSpanPx);
  return stats;
}
