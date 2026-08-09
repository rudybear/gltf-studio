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

/** RH-018: the three gizmo modes attachGizmo can attach. */
export type GizmoMode = "translate" | "rotate" | "scale";

export interface GizmoChangeEvent {
  phase: GizmoChangePhase;
  nodeIndex: number;
  trs: TRS;
}

/**
 * RH-022/RH-023 (see specs/render-host.md): the highlighted-node set is
 * modeled as a plain array of node indices rather than a
 * selection/hover-split object — the editor computes whatever union of
 * selection+hover it wants highlighted and passes the resulting set each
 * time. `setHighlight([])` clears all highlighting (RH-023).
 */
export interface RenderHost {
  // RESOLVED(RH-mount-shape-tbd) at the engine-api (interface) layer: plan
  // names "mount" without specifying its parameter beyond "viewport" — a DOM
  // container is the minimal reasonable reading for a browser render host,
  // and stays that way here. See specs/render-host.md's "Open questions" for
  // engine-three's concrete choice of what it does with that container
  // (owns its own child canvas, resizes via ResizeObserver). Lifecycle
  // behavior (idempotency, re-entry) is pinned down by RH-004, RH-009,
  // RH-010.
  mount(container: HTMLElement): void;

  // RESOLVED(RH-loadscene-shape-tbd) at the engine-api (interface) layer:
  // stays `unknown` here (pending editor-core's document shape, see
  // specs/document-model.md, and because a future non-three RenderHost may
  // want a different concrete shape) — see specs/render-host.md's "Open
  // questions" for engine-three's concrete accepted shape. Lifecycle
  // behavior (readiness, re-entry) is pinned down by RH-007, RH-008.
  loadScene(json: unknown): Promise<void>;

  /** RH-005/RH-006: idempotent, and safe to call without a prior loadScene. */
  dispose(): void;

  /**
   * RH-001: fast path for edit-time updates. Structural patches honestly
   * return "needs-reload" in v1 rather than attempting a live structural
   * splice. RH-011/RH-012/RH-013 define the structural/non-structural
   * classification rule.
   */
  patchScene(patches: JsonPatchOp[]): PatchOutcome;

  /**
   * RH-015: `x`/`y` are normalized device coordinates in [-1, 1] on both
   * axes, with +y up (not viewport-relative pixels).
   */
  pick(x: number, y: number): PickResult | null;

  /** RH-016/RH-017: see CameraPose (position + quaternion + optional target). */
  getCameraPose(): CameraPose;
  setCameraPose(pose: CameraPose): void;

  /** RH-018/RH-019: attaches/replaces a gizmo of the given mode on the node. */
  attachGizmo(nodeIndex: number, mode: GizmoMode): void;
  onGizmoChange(handler: (event: GizmoChangeEvent) => void): () => void;

  // RESOLVED(RH-pointer-value-tbd) at the engine-api (interface) layer:
  // stays `unknown` here — the plan's pointer-router reuse note (~35
  // families) implies a wide variety of pointer value shapes that this
  // types-only package should not narrow prematurely. See
  // specs/render-host.md's "Open questions" for engine-three's concrete
  // accepted value shape (the three-adapter's own PointerValue union).
  // Delegation/return contract pinned down by RH-020, RH-021.
  applyPointer(pointer: string, value: unknown): void;

  /** RH-022/RH-023. */
  setHighlight(nodeIndices: number[]): void;

  /**
   * RH-024: resolves to a Promise of a PNG-encoded Blob at the render
   * canvas's current resolution. See specs/render-host.md's "Open
   * questions" for the unresolved tension with PC-003's use of "snapshot"
   * to describe restoring pre-play scene *state* (not just an image).
   */
  snapshot(): Promise<Blob>;
}
