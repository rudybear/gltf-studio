import { describe, expect, it } from "vitest";
import {
  agentServiceContractObligations,
  audioHostContractObligations,
  describeAgentServiceContract,
  describeAudioHostContract,
  describePlayControllerContract,
  describeRenderHostContract,
  describeStorageProviderContract,
  playControllerContractObligations,
  renderHostContractObligations,
  storageProviderContractObligations
} from "./index.js";

// M0 gate: no implementation of RenderHost/StorageProvider/PlayController/
// AudioHost/AgentService exists yet, so this file does not (and cannot) assert real
// contract behavior. It instead asserts the todo inventory itself is real:
// each describe-factory exists and names at least one obligation. CI stays
// green (it.todo entries are reported as todo, not failed) while the
// contract obligations are visibly enumerated — see the suites instantiated
// below, which show up as skipped/todo tests in `vitest run` output.
describe("contract-tests self-check", () => {
  it("exports a non-empty obligation list per contract", () => {
    expect(renderHostContractObligations.length).toBeGreaterThan(0);
    expect(storageProviderContractObligations.length).toBeGreaterThan(0);
    expect(playControllerContractObligations.length).toBeGreaterThan(0);
    expect(audioHostContractObligations.length).toBeGreaterThan(0);
    expect(agentServiceContractObligations.length).toBeGreaterThan(0);
  });

  it("exports a describe-factory function per contract", () => {
    expect(typeof describeRenderHostContract).toBe("function");
    expect(typeof describeStorageProviderContract).toBe("function");
    expect(typeof describePlayControllerContract).toBe("function");
    expect(typeof describeAudioHostContract).toBe("function");
    expect(typeof describeAgentServiceContract).toBe("function");
  });
});

// Instantiate each still-`it.todo` suite (no implementation backs these
// `makeX` functions — they are never called, since it.todo bodies never
// run) purely so the full todo inventory is visible in test output
// alongside this file's own assertions.
//
// `describeStorageProviderContract` is deliberately NOT instantiated here
// (unlike its still-it.todo siblings below): as of M2 it runs real
// assertions (see storage-provider.ts), so it needs a working
// `StorageProvider` — it is exercised for real by
// `@gltf-studio/storage`'s indexeddb-storage.test.ts and
// filesystem-storage.test.ts instead, against the two real
// implementations.
describeRenderHostContract(() => {
  throw new Error("no RenderHost implementation yet (M0 scope)");
});
describePlayControllerContract(() => {
  throw new Error("no PlayController implementation yet (M0 scope)");
});
describeAudioHostContract(() => {
  throw new Error("no AudioHost implementation yet (M0 scope)");
});
describeAgentServiceContract(() => {
  throw new Error("no AgentService implementation yet (M0 scope)");
});
