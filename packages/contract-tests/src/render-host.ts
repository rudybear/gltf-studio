import { describe, it } from "vitest";
import type { RenderHost } from "@gltf-studio/engine-api";

/**
 * RenderHost contract obligations, transcribed from Phase A of the program
 * plan. `it.todo` entries below register these as a visible inventory
 * before any RenderHost implementation (engine-three) exists; flesh out
 * with real assertions per obligation once M2 lands engine-three.
 */
export const renderHostContractObligations: string[] = [
  "mount is idempotent: calling mount() twice does not throw or double-attach",
  "loadScene resolves once the scene is ready for pick/patchScene calls",
  "dispose is idempotent: calling dispose() twice does not throw",
  "dispose after mount without a prior loadScene does not throw",
  'patchScene returns "applied" for a non-structural patch (RH-001)',
  'patchScene returns "needs-reload" for a structural patch (RH-001)',
  "pick returns null when nothing is under the given coordinates",
  "pick returns a PickResult with the correct nodeIndex for a hit",
  "getCameraPose/setCameraPose round-trip",
  'attachGizmo + onGizmoChange emits phase "drag" while dragging and phase "commit" exactly once on release (RH-003)',
  "applyPointer writes the given pointer/value without requiring a reload",
  "setHighlight updates both selected and hovered independently",
  "snapshot() after loadScene captures enough state to restore the scene (consumed by PlayController.stop(), PC-003)"
];

export function describeRenderHostContract(makeHost: () => RenderHost): void {
  describe("RenderHost contract", () => {
    for (const obligation of renderHostContractObligations) {
      it.todo(obligation);
    }
  });
  // OPEN(RH-contract-usage-tbd): makeHost is unused until real obligations
  // are fleshed out with assertions (it.todo bodies are never invoked);
  // kept as a parameter so this factory's signature matches
  // "describeRenderHostContract(makeHost)" from the plan.
  void makeHost;
}
