import { describe, it } from "vitest";
import type { AudioHost } from "@gltf-studio/engine-api";

/**
 * AudioHost contract obligations, transcribed from Phase A.
 */
export const audioHostContractObligations: string[] = [
  "init does not create/resume an AudioContext before a user gesture (AH-001)",
  "init after a user gesture resolves without throwing",
  "loadEmitters is idempotent: calling it twice with the same input does not duplicate emitters",
  "applyPointer writes the given pointer/value onto the loaded emitters/environment state",
  "setListenerPose updates spatialization for subsequently auditioned emitters",
  "auditionEmitter plays the given emitter index without throwing when initialized",
  "suspend is idempotent: calling it twice does not throw",
  "resume after suspend restores audible output",
  "dispose is idempotent: calling it twice does not throw",
  "dispose after suspend (without resume) does not throw"
];

export function describeAudioHostContract(makeHost: () => AudioHost): void {
  describe("AudioHost contract", () => {
    for (const obligation of audioHostContractObligations) {
      it.todo(obligation);
    }
  });
  // OPEN(AH-contract-usage-tbd): see the equivalent note on
  // describeRenderHostContract.
  void makeHost;
}
