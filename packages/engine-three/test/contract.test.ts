// Runs the full, real RenderHost contract suite (packages/contract-tests/src/render-host.ts)
// against engine-three's actual implementation, in a real browser (vitest
// browser mode, Playwright + headless Chromium — see vitest.config.ts).
import { describeRenderHostContract } from "@gltf-studio/contract-tests";
import { createThreeRenderHost } from "../src/index.js";

describeRenderHostContract(() => createThreeRenderHost());
