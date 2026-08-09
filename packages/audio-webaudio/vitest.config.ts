/// <reference types="@vitest/browser/providers/playwright" />
// Browser-mode config for audio-webaudio's contract suite: a REAL
// AudioContext via Playwright + headless Chromium (jsdom/node have no Web
// Audio API at all) — mirrors packages/engine-three/vitest.config.ts's
// pattern (same rationale: Chromium is launched via the `chrome` channel
// using the system Google Chrome install, matching CI's GitHub-hosted
// runners, unless GLTF_STUDIO_PLAYWRIGHT_CHANNEL=0).
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
          args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"]
        }
      }
    }
  }
});
