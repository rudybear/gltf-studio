import { describe, it } from "vitest";
import type { RenderHost } from "@gltf-studio/engine-api";

/**
 * RenderHost contract obligations, transcribed from Phase A of the program
 * plan. `it.todo` entries below register these as a visible inventory
 * before any RenderHost implementation (engine-three) exists; flesh out
 * with real assertions per obligation once M2 lands engine-three.
 */
export const renderHostContractObligations: string[] = [
  "mount is idempotent: calling mount() twice does not throw or double-attach (RH-004)",
  "loadScene resolves once the scene is ready for pick/patchScene calls (RH-007)",
  "dispose is idempotent: calling dispose() twice does not throw (RH-005)",
  "dispose after mount without a prior loadScene does not throw (RH-006)",
  "calling loadScene again while a scene is already loaded replaces it (RH-008)",
  "calling mount again with a different container detaches from the previous one (RH-009)",
  "mount after dispose re-initializes the RenderHost for reuse (RH-010)",
  'patchScene returns "applied" for a non-structural patch (RH-001)',
  'patchScene returns "needs-reload" for a structural patch (RH-001)',
  "patchScene classifies an add/remove/move on an array as structural (RH-011)",
  "patchScene classifies any op under /nodes, /scenes, /scene, or /meshes as structural (RH-012)",
  "patchScene classifies a replace on a leaf field as non-structural (RH-013)",
  'patchScene returns "needs-reload" for a batch if any one patch in it is structural (RH-014)',
  "pick returns null when nothing is under the given NDC coordinates (RH-015)",
  "pick returns a PickResult with the correct nodeIndex for a hit at NDC coordinates (RH-015)",
  "getCameraPose/setCameraPose round-trip position and rotation (RH-016, RH-017)",
  "attachGizmo accepts a GizmoMode of translate, rotate, or scale (RH-018)",
  "attachGizmo while a gizmo is already attached replaces it without an explicit detach (RH-019)",
  'attachGizmo + onGizmoChange emits phase "drag" while dragging and phase "commit" exactly once on release (RH-003)',
  "applyPointer writes the given pointer/value without requiring a reload (RH-020)",
  "applyPointer does not create a HistoryStack entry (RH-021)",
  "setHighlight(indices) highlights exactly the given node indices (RH-022)",
  "setHighlight([]) clears all highlighting (RH-023)",
  "snapshot() after loadScene resolves to a PNG Blob at the canvas's current resolution (RH-024)"
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
