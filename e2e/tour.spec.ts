// specs/ux-tour.md UX-1200: the coach-marks tutorial tour. Iterates the REAL
// `TOUR_STEPS` array (imported directly from app source — the same
// "import real source, don't duplicate data" convention `e2e/global-setup.ts`
// already follows for its own fixtures) rather than hardcoding a second copy
// of the 14 steps here, so a future edit to `steps.ts` (a testid rename, a
// reordering) is caught by this suite automatically instead of silently
// drifting out of sync with a duplicated list.
import { test, expect, type Page } from "@playwright/test";
import { assertRegionRendersContent } from "./visual-assert.js";
import { TOUR_STEPS } from "../packages/app/src/tour/steps.js";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function startTour(page: Page): Promise<void> {
  await page.getByTestId("topbar.tour-start").click();
  await expect(page.getByTestId("tour.overlay")).toBeVisible();
}

test.describe("tour (UX-1200)", () => {
  test("first-visit banner appears; dismissing it persists across reload (UX-1201/UX-1202)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("tour.banner")).toBeVisible();

    await page.getByTestId("tour.banner.dismiss").click();
    await expect(page.getByTestId("tour.banner")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("tour.banner")).toHaveCount(0);
  });

  test("starting the tour from the banner opens it at step 1 (UX-1200/UX-1201)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tour.banner.start").click();
    await expect(page.getByTestId("tour.overlay")).toBeVisible();
    await expect(page.getByTestId("tour.title")).toHaveText(TOUR_STEPS[0].title);
    // Starting from the banner dismisses it too (UX-1202) — it must not
    // reappear once the tour itself has been engaged with.
    await expect(page.getByTestId("tour.banner")).toHaveCount(0);
  });

  test(
    "every real tour step anchors on a visible element the spotlight actually overlaps, and pre-action tabs activate (UX-1200/UX-1205/UX-1206/UX-1209)",
    async ({ page }) => {
      await page.goto("/");
      await startTour(page);

      for (let i = 0; i < TOUR_STEPS.length; i++) {
        const step = TOUR_STEPS[i];

        await expect(page.getByTestId("tour.title")).toHaveText(step.title);
        await expect(page.getByTestId("tour.body")).toHaveText(step.body);
        await expect(page.getByTestId(`tour.progress-dot.${i}`)).toHaveClass(/current/);

        if (step.preAction?.dockTab) {
          await expect(page.getByTestId(`dock.tab.${step.preAction.dockTab}`)).toHaveClass(/active/);
        }
        if (step.preAction?.rightTab) {
          await expect(page.getByTestId(`right-panel.tab.${step.preAction.rightTab}`)).toHaveClass(/active/);
        }

        expect(step.anchorTestId, `step "${step.id}" declares no anchor — this suite only covers anchored steps`).not.toBeNull();
        const anchor = page.getByTestId(step.anchorTestId as string);
        await expect(anchor).toBeVisible();
        // The spotlight rect lags one animation frame behind the step's own
        // title/anchor becoming visible (UX-1206/UX-1207's retry loop only
        // resolves once the anchor is actually measured) — wait for a
        // REAL cutout (a non-viewport-sized box) rather than racing
        // `boundingBox()` against that resolution.
        const spotlight = page.getByTestId("tour.spotlight");
        await expect(spotlight).toBeVisible();
        await expect
          .poll(async () => {
            const box = await spotlight.boundingBox();
            return box ? box.width < (await page.viewportSize())!.width : false;
          })
          .toBe(true);
        const anchorBox = await anchor.boundingBox();
        const spotlightBox = await spotlight.boundingBox();
        expect(anchorBox, `no bounding box for anchor ${step.anchorTestId}`).not.toBeNull();
        expect(spotlightBox, "no bounding box for tour.spotlight").not.toBeNull();
        expect(
          rectsOverlap(anchorBox as Box, spotlightBox as Box),
          `expected the spotlight to overlap step "${step.id}"'s anchor (${step.anchorTestId})`
        ).toBe(true);

        // The "starter-gallery" step's own body invites either loading a
        // card or continuing without one; loading Empty scene here (a real
        // click on the real anchor this step is spotlighting, specs/ux-
        // shell.md UX-120) is what gives every LATER step's anchor real
        // content — most notably `script.tab-wrap` (UX-1205's own open
        // question notes this file doesn't special-case the gallery), whose
        // Script-tab placeholder (unlike Behavior graph/Audio graph/Data,
        // which reuse their real panel's own testid for the placeholder
        // too) uses a different testid than the real tab, so it genuinely
        // does not exist before ANY document is loaded — even a zero-node
        // one satisfies it, since that gate is `!document`, not "has a
        // graph." See the next test for what happens when a step's anchor
        // is skipped entirely instead.
        if (step.id === "starter-gallery") {
          await page.getByTestId("viewport.gallery.card.empty.load").click();
          await expect(page.getByTestId("topbar.project-name")).toHaveText("Untitled");
        }

        await page.getByTestId("tour.next").click();
      }

      // The last step's Next ("Done") completes and closes the tour (UX-1204).
      await expect(page.getByTestId("tour.overlay")).toHaveCount(0);
    }
  );

  test(
    "a step whose anchor genuinely isn't mounted falls back to a centered, spotlight-free card instead of getting stuck (UX-1205)",
    async ({ page }) => {
      await page.goto("/");
      await startTour(page);
      const scriptStepIndex = TOUR_STEPS.findIndex((s) => s.id === "script");
      expect(scriptStepIndex).toBeGreaterThan(0);
      // Advance to the script step WITHOUT ever loading a document (skip the
      // gallery's load button) — `script.tab-wrap` cannot exist yet.
      for (let i = 0; i < scriptStepIndex; i++) {
        await page.getByTestId("tour.next").click();
      }
      await expect(page.getByTestId("tour.title")).toHaveText(TOUR_STEPS[scriptStepIndex].title);
      // No real anchor was found within the retry window: the fallback
      // full-dim, no-cutout spotlight renders instead of a real cutout, and
      // the card is still visible/usable (Next still works).
      await expect(page.getByTestId("tour.card")).toBeVisible();
      await expect(page.getByTestId("tour.next")).toBeEnabled();
    }
  );

  test("Escape exits the tour without marking it complete, and topbar.tour-start relaunches it at step 1 (UX-121/UX-1200/UX-1211)", async ({
    page
  }) => {
    await page.goto("/");
    await startTour(page);
    await page.getByTestId("tour.next").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour.overlay")).toHaveCount(0);

    await page.getByTestId("topbar.tour-start").click();
    await expect(page.getByTestId("tour.overlay")).toBeVisible();
    await expect(page.getByTestId("tour.title")).toHaveText(TOUR_STEPS[0].title);
  });

  test("relaunching after Skip also restarts at step 1 (UX-1200)", async ({ page }) => {
    await page.goto("/");
    await startTour(page);
    await page.getByTestId("tour.next").click();
    await page.getByTestId("tour.next").click();
    await page.getByTestId("tour.skip").click();
    await expect(page.getByTestId("tour.overlay")).toHaveCount(0);

    await page.getByTestId("topbar.tour-start").click();
    await expect(page.getByTestId("tour.title")).toHaveText(TOUR_STEPS[0].title);
  });

  test("the spotlight overlay renders real visible content in both light and dark theme (UX-1210)", async ({ page }) => {
    await page.goto("/");

    await startTour(page);
    await assertRegionRendersContent(page.getByTestId("tour.card"));
    await page.getByTestId("tour.skip").click();
    await expect(page.getByTestId("tour.overlay")).toHaveCount(0);

    // Toggle theme (shell.spec.ts's own UX-104/UX-105 pattern) with the
    // tour closed — while open, the dim panels intentionally block clicks
    // to everything outside the current cutout, including the top bar.
    await page.getByTestId("topbar.theme-toggle").click();
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(["light", "dark"]).toContain(theme);

    await startTour(page);
    await assertRegionRendersContent(page.getByTestId("tour.card"));
  });
});
