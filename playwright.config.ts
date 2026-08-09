import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

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
  workers: 4,
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
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.CI ? ["--no-sandbox"] : []
        }
      }
    }
  ]
});
