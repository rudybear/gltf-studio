// Runs the full, real AudioHost contract suite
// (packages/contract-tests/src/audio-host.ts) against WebAudioHost's actual
// implementation, in a real browser (vitest browser mode, Playwright +
// headless Chromium with autoplay unblocked — see vitest.config.ts).
import { describeAudioHostContract } from "@gltf-studio/contract-tests";
import { WebAudioHost } from "../src/index.js";

describeAudioHostContract(() => new WebAudioHost());
