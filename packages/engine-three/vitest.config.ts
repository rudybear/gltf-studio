/// <reference types="@vitest/browser/providers/playwright" />
// Browser-mode config for engine-three's contract suite: real WebGL/DOM via
// Playwright + headless Chromium, kept entirely separate from the repo
// root's node-environment `vitest.config.ts` (which only globs
// packages/*/src/**/*.test.ts — this package's tests live under test/, not
// src/, and are run via the `test:browser` script instead of the plain
// `vitest run`). Chromium is launched via the `chrome` channel (using the
// system Google Chrome install) rather than downloading Playwright's own
// bundled Chromium — matches this repo's CI, where a system Chrome is
// already present on GitHub-hosted runners (see .github/workflows/ci.yml).
import { defineConfig } from "vitest/config";

const useSystemChrome = process.env.GLTF_STUDIO_PLAYWRIGHT_CHANNEL !== "0";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      name: "chromium",
      headless: true,
      providerOptions: {
        launch: {
          ...(useSystemChrome ? { channel: "chrome" } : {}),
          args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
        }
      }
    }
  }
});
