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

// OPEN(EA-camerapose-shape-tbd): the plan names "camera pose" (RenderHost) as
// a shared value type but does not specify orbit/target vs look-direction vs
// raw transform. Modeled here as position + look-at target, the shape the
// reused three-adapter's OrbitControls-style camera already uses; revisit
// against RH's full spec.
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
}

// OPEN(EA-pickresult-shape-tbd): the plan says RenderHost has a "pick"
// method and PickResult is a shared value type, but does not enumerate
// PickResult's fields beyond "picking" (Raycaster-backed, swappable per the
// reuse table). nodeIndex is the one field the plan's reuse notes
// (glTF-index<->Object3D index tables) make unambiguous.
export interface PickResult {
  nodeIndex: number;
  point: [number, number, number];
}

// OPEN(EA-projectmeta-shape-tbd): the plan names ProjectMeta/ProjectData as
// shared value types (StorageProvider's listProjects/create/load/save) but
// does not enumerate fields. id/name are the minimum StorageProvider's
// listing surface implies; timestamps are a reasonable inference for a
// project list UI but are flagged as inferred, not specified.
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

// OPEN(EA-projectdata-shape-tbd): the plan does not specify ProjectData's
// shape. `container` is left `unknown` deliberately — Phase A puts the
// pristine parsed container and the immutable json on EditorDocument, which
// lives in the not-yet-scaffolded editor-core package, not engine-api; this
// field is a placeholder for whatever editor-core hands StorageProvider.save.
export interface ProjectData {
  meta: ProjectMeta;
  container: unknown;
}
