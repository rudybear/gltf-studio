// Runs the full, real PlayController contract suite
// (packages/contract-tests/src/play-controller.ts) against this package's
// actual implementation, under vitest's plain Node environment (see the
// root vitest.config.ts, which globs packages/*/src/**/*.test.ts). The
// "compiled" engine obligation is auto-skipped here by the shared contract
// file's own `canRunCompiled` check (Node has no window/document — see
// engine-host.ts's note on blob: URL dynamic import not working under
// Node's ESM loader); it is exercised for real instead by
// packages/play/test/contract.test.ts (vitest browser mode).
import {
  CONTRACT_UNHANDLED_POINTER,
  contractGraphJson,
  createFakeRenderHost,
  createManualFrameScheduler,
  describePlayControllerContract,
  type PlayControllerHarness
} from "@gltf-studio/contract-tests";
import { createPlayController } from "./index.js";

describePlayControllerContract(
  (): PlayControllerHarness => {
    const documentJson = contractGraphJson();
    const renderHost = createFakeRenderHost({ throwOnPointer: CONTRACT_UNHANDLED_POINTER });
    const scheduler = createManualFrameScheduler();
    const controller = createPlayController({
      renderHost,
      getDocumentJson: () => documentJson,
      scheduler
    });
    return { controller, renderHost, documentJson, scheduler };
  },
  // The one real-scheduler smoke assertion (see describePlayControllerContract's
  // doc comment): no `scheduler` override here, so this controller runs
  // against the actual production createDefaultScheduler() (Node has no
  // window, so this is the ~60fps setTimeout fallback — see scheduler.ts).
  () => {
    const documentJson = contractGraphJson();
    const renderHost = createFakeRenderHost({ throwOnPointer: CONTRACT_UNHANDLED_POINTER });
    const controller = createPlayController({
      renderHost,
      getDocumentJson: () => documentJson
    });
    return { controller };
  }
);
