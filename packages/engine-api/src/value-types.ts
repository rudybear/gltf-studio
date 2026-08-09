/**
 * Shared value types used across the editor<->engine interfaces. Transcribed
 * from Phase A of the program plan, which names these types without always
 * enumerating their fields — see the OPEN comments below for what is
 * genuinely unspecified rather than guessed.
 */

/** PlayController.start()'s two supported execution engines. */
export type EngineKind = "interpreter" | "compiled";

/** A node's local transform: translation/rotation/scale, glTF-convention. */
export interface TRS {
  translation: [number, number, number];
  /** Quaternion, glTF order (x, y, z, w). */
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

/**
 * RH-016 (see specs/render-host.md): position + orientation quaternion is
 * the primary representation; `target` is an optional look-at point for
 * orbit-style controls layered on top (RH-017 defines the get/set
 * round-trip contract).
 */
export interface CameraPose {
  position: [number, number, number];
  /** Quaternion, glTF order (x, y, z, w). */
  rotation: [number, number, number, number];
  target?: [number, number, number];
}

// RESOLVED(EA-pickresult-shape-tbd) (see specs/render-host.md's "Open
// questions"): the plan says RenderHost has a "pick" method and PickResult
// is a shared value type, but did not originally enumerate PickResult's
// fields beyond "picking" (Raycaster-backed, swappable per the reuse
// table). nodeIndex/point are the fields the plan's reuse notes (glTF-index
// <-> Object3D index tables) made unambiguous; `distance` (the world-space
// ray length from the camera to `point`) is added because engine-three's
// underlying Raycaster hit (THREE.Intersection) always carries it for free
// and callers (e.g. a "closest of several picks" comparison, or a
// depth-aware inspector readout) have an obvious use for it. Barycentric
// coordinates and material index remain deliberately omitted — no consumer
// needs them yet. pick()'s coordinate space (not PickResult's shape) is
// pinned down by RH-015.
export interface PickResult {
  nodeIndex: number;
  point: [number, number, number];
  distance: number;
}

/** SP-011 (see specs/storage-provider.md): thumbnail is the only optional field. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: Blob;
}

/**
 * SP-012: `container` is exactly the byte output of `writeContainer`
 * (produced by the document layer's save path, see
 * specs/document-model.md); `sidecar` is opaque to StorageProvider — it
 * persists and returns it without interpreting its contents (its concrete
 * shape, per Phase A's "State homes", is panel layout/camera bookmarks and
 * belongs to editor-core/app, not this types-only package).
 */
export interface ProjectData {
  meta: ProjectMeta;
  container: Uint8Array;
  sidecar: unknown;
}
