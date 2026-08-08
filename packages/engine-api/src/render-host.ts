import type { JsonPatchOp } from "./json-patch.js";
import type { CameraPose, PickResult, TRS } from "./value-types.js";

/**
 * RenderHost: the viewport abstraction. The editor never imports three.js
 * (or any renderer library) directly — engine-three implements this
 * interface by delegating to buildIndexTables + the pointer-router +
 * Raycaster picking (see Phase A / the reuse table). Structural patches
 * honestly return "needs-reload" in v1 (RH-001).
 */
export type PatchOutcome = "applied" | "needs-reload";

/**
 * attachGizmo/onGizmoChange: drag = live pointer writes (fast, no command);
 * commit = a SceneEdit.setTransform command (undoable, one history entry).
 */
export type GizmoChangePhase = "drag" | "commit";

export interface GizmoChangeEvent {
  phase: GizmoChangePhase;
  nodeIndex: number;
  trs: TRS;
}

// OPEN(RH-highlight-shape-tbd): the plan lists "selection/hover highlight"
// as one capability phrase without specifying whether it is one call or two
// (setSelection/setHover). Modeled as a single method taking both pieces of
// state so there is one source of truth for "what's highlighted"; revisit
// once RH's full spec (a later task, per the plan's "Immediate next steps")
// pins this down.
export interface HighlightState {
  selected: number[];
  hovered: number | null;
}

export interface RenderHost {
  // OPEN(RH-mount-shape-tbd): plan names "mount" without specifying its
  // parameter beyond "viewport" — a DOM container is the minimal reasonable
  // reading for a browser render host.
  mount(container: HTMLElement): void;

  // OPEN(RH-loadscene-shape-tbd): plan does not specify whether loadScene
  // takes raw glTF JSON, a parsed container, or an EditorDocument-derived
  // view. `unknown` pending editor-core's document shape.
  loadScene(json: unknown): Promise<void>;

  dispose(): void;

  /**
   * RH-001: fast path for edit-time updates. Structural patches honestly
   * return "needs-reload" in v1 rather than attempting a live structural
   * splice.
   */
  patchScene(patches: JsonPatchOp[]): PatchOutcome;

  // OPEN(RH-pick-coords-tbd): plan does not specify pick's coordinate space
  // (viewport-relative pixels vs normalized device coordinates).
  pick(x: number, y: number): PickResult | null;

  getCameraPose(): CameraPose;
  setCameraPose(pose: CameraPose): void;

  // OPEN(RH-gizmo-kind-tbd): plan says "attachGizmo" without a gizmo
  // kind/mode parameter (translate/rotate/scale); left out rather than
  // guessed an enum the plan never names.
  attachGizmo(nodeIndex: number): void;
  onGizmoChange(handler: (event: GizmoChangeEvent) => void): () => void;

  // OPEN(RH-pointer-value-tbd): applyPointer's value type is left `unknown`
  // — the plan's pointer-router reuse note (~35 families) implies a wide
  // variety of pointer value shapes that this types-only package should not
  // narrow prematurely.
  applyPointer(pointer: string, value: unknown): void;

  setHighlight(state: HighlightState): void;

  // OPEN(RH-snapshot-shape-tbd): snapshot()'s return type is left `unknown`.
  // PlayController.stop() (PC-003) uses it to restore the pre-play scene;
  // the concrete shape is an engine-three implementation detail until RH's
  // full spec pins down a contract every RenderHost impl must honor.
  snapshot(): unknown;
}
