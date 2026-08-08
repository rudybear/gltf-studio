import { describe, it } from "vitest";
import type { PlayController } from "@gltf-studio/engine-api";

/**
 * PlayController contract obligations, transcribed from Phase A. One
 * fan-out SceneAdapter.applyPointer -> renderHost ‖ audioHost is assumed
 * by the plan but is an engine-three/audio-webaudio integration concern,
 * not directly assertable against PlayController alone; obligations below
 * are the ones PlayController itself owns.
 */
export const playControllerContractObligations: string[] = [
  'start({ engine: "interpreter" }) begins ticking without throwing (PC-001)',
  'start({ engine: "compiled" }) begins ticking without throwing (PC-001)',
  "pause stops ticking until resume is called",
  "resume continues ticking from where pause left off",
  "tickOnce advances exactly one tick while paused",
  "stop() contractually reloads the scene snapshot (PC-003)",
  "stop() after stop() (already stopped) does not throw",
  "inspect() reports time/variables/sentEvents consistent with ticks that have occurred",
  "onDiagnostic handlers fire for diagnostics raised during play",
  "the unsubscribe function returned by onDiagnostic stops further delivery"
];

export function describePlayControllerContract(makeController: () => PlayController): void {
  describe("PlayController contract", () => {
    for (const obligation of playControllerContractObligations) {
      it.todo(obligation);
    }
  });
  // OPEN(PC-contract-usage-tbd): see the equivalent note on
  // describeRenderHostContract.
  void makeController;
}
