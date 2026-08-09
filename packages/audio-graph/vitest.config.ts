/// <reference types="@vitest/browser/providers/playwright" />
// Browser-mode config for audio-graph's tests: AudioGraphJS's `buildGraph`
// (called from `audition()`) needs a real `AudioContext`/`BaseAudioContext`
// — see packages/audio-webaudio/vitest.config.ts's identical rationale.
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
          args: ["--autoplay-policy=no-user-gesture-required"]
        }
      }
    }
  }
});
