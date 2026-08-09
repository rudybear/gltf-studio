import { describe, expect, it } from "vitest";
import { createDefaultScheduler } from "./scheduler.js";

// This suite runs under vitest's plain Node environment (no DOM, no
// requestAnimationFrame) — so createDefaultScheduler() is expected to take
// its setTimeout-based fallback branch here every time. A browser-mode run
// (see packages/engine-three's vitest.config.ts precedent) would exercise
// the requestAnimationFrame branch instead; both branches share the same
// `FrameScheduler` contract asserted below.
describe("createDefaultScheduler (Node fallback branch)", () => {
  it("now() returns a non-decreasing number", () => {
    const scheduler = createDefaultScheduler();
    const a = scheduler.now();
    const b = scheduler.now();
    expect(typeof a).toBe("number");
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("requestFrame eventually invokes the callback with a number", async () => {
    const scheduler = createDefaultScheduler();
    const now = await new Promise<number>((resolve) => {
      scheduler.requestFrame(resolve);
    });
    expect(typeof now).toBe("number");
  });

  it("cancelFrame prevents a scheduled callback from firing", async () => {
    const scheduler = createDefaultScheduler();
    let fired = false;
    const handle = scheduler.requestFrame(() => {
      fired = true;
    });
    scheduler.cancelFrame(handle);
    // Wait comfortably longer than the ~16ms fallback frame interval.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fired).toBe(false);
  });
});
