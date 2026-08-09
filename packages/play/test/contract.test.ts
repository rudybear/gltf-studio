// Runs the full, real PlayController contract suite
// (packages/contract-tests/src/play-controller.ts) against this package's
// actual implementation, in a real browser (vitest browser mode, Playwright
// + headless Chromium — see vitest.config.ts). Since this environment has a
// real window/document, this run additionally exercises the "compiled"
// engine obligation for real (packages/play/src/contract.test.ts, which
// runs under plain Node, cannot — see that file's comment).
import {
  CONTRACT_UNHANDLED_POINTER,
  contractGraphJson,
  createFakeRenderHost,
  describePlayControllerContract,
  type PlayControllerHarness
} from "@gltf-studio/contract-tests";
import { createPlayController } from "../src/index.js";

describePlayControllerContract((): PlayControllerHarness => {
  const documentJson = contractGraphJson();
  const renderHost = createFakeRenderHost({ throwOnPointer: CONTRACT_UNHANDLED_POINTER });
  const controller = createPlayController({
    renderHost,
    getDocumentJson: () => documentJson
  });
  return { controller, renderHost, documentJson };
});
