import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// The app's own vite.config.ts now defaults `base` to "/app/" (the editor
// always lives one level below whatever site root it's served from — see
// that file's own comment), so the BUILT app `vite preview` serves is only
// reachable under that path, not at the server root. Every spec's
// `page.goto("./")` (NOT `page.goto("/")` — a leading slash would replace
// this whole path, not append to it, per the URL spec `new URL()` combining
// rules Playwright's `baseURL` option uses) relies on this trailing slash.
const BASE_URL = `http://localhost:${PORT}/app/`;

// Targets the BUILT app (`vite preview`), not the dev server — the app's
// `pnpm -F app build` output is what CI/e2e actually exercises. Run
// `pnpm build` once, then `pnpm e2e` (see package.json's scripts). CI wires
// this as a separate job with `needs: build`.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // Capped rather than Playwright's own core-count-based default: several
  // suites in this project drive REAL GPU work in the same headless
  // Chromium (engine-three's actual WebGL RenderHost in viewport.spec.ts;
  // graph-canvas's ELK layout worker + React Flow's SVG/canvas rendering) —
  // running many of those instances fully concurrently on a many-core
  // machine was observed to starve unrelated pages badly enough that a
  // completely unrelated page's React state updates stalled for 45+
  // seconds (found stabilizing e2e/graph-canvas.spec.ts). A modest cap
  // trades some wall-clock time for that not happening.
  //
  // Lower still in CI (M7 follow-up): GitHub-hosted `ubuntu-latest` runners
  // have 4 vCPUs, not the many-core dev machine the cap above was tuned
  // against — 4 workers there means every worker's headless Chromium (some
  // with real WebGL, some with a real ELK layout worker thread) fully
  // saturates the box, reproducing the exact "unrelated page's React state
  // update stalls for 45+ seconds" starvation e2e/graph-canvas.spec.ts:67's
  // own `test.slow()` + explicit 45000ms timeout were already defending
  // against — just past its margin once M7 added more concurrently-running
  // spec files (e2e/audio.spec.ts) to the same fixed 4-worker budget.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm --filter @gltf-studio/app run preview -- --port 4173 --strictPort",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ["**/golden-path.spec.ts", "**/racer.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.CI ? ["--no-sandbox"] : []
        }
      }
    },
    // golden-path.spec.ts (the checkpoint's full-journey smoke test) runs as
    // its own project, `dependencies: ["chromium"]` — Playwright always runs
    // a dependency project to completion before a dependent one starts, so
    // this is guaranteed to run LAST, after every other spec file, with no
    // ordering trick needed inside the "chromium" project itself. It is a
    // single `test()` (see that file's own doc comment), so no separate
    // worker-count/serial-mode setting is needed here either.
    {
      name: "golden-path",
      testMatch: "**/golden-path.spec.ts",
      dependencies: ["chromium"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.CI ? ["--no-sandbox"] : []
        }
      }
    },
    // e2e/racer.spec.ts (samples/r4-racer.glb at its real 366-graph-node
    // scale): `dependencies: ["golden-path"]` chains it after BOTH the
    // "chromium" project and the golden path (a dependency project always
    // runs to completion first), so this heavy, single-scenario spec never
    // shares a worker's CPU/GPU budget with anything else — same rationale
    // as golden-path's own project, one level further out.
    {
      name: "racer",
      testMatch: "**/racer.spec.ts",
      dependencies: ["golden-path"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.CI ? ["--no-sandbox"] : []
        }
      }
    }
  ]
});
