import type { CameraPose } from "./value-types.js";

/**
 * AudioHost: KHR_audio_emitter/_environment authoring + playback. Lifts the
 * gltf-webgpu audio layer (spatial.ts + AudioSystem) per the reuse table;
 * this interface itself must stay implementation-agnostic.
 */
export interface AudioHost {
  /**
   * AH-001: gesture-gated — must not create/resume an AudioContext before a
   * user gesture. OPEN(AH-init-signature-tbd): the plan does not specify
   * how the gesture is threaded through (an awaited call site the app makes
   * on click, an internal queue-until-gesture, etc.).
   */
  init(): Promise<void>;

  // OPEN(AH-loademitters-shape-tbd): plan does not specify loadEmitters'
  // input shape (raw glTF JSON vs a pre-resolved emitters/environments
  // slice).
  loadEmitters(json: unknown): Promise<void>;

  // OPEN(AH-pointer-value-tbd): mirrors RenderHost.applyPointer's open
  // question — value type intentionally left `unknown`.
  applyPointer(pointer: string, value: unknown): void;

  // OPEN(AH-listenerpose-shape-tbd): plan does not say whether the listener
  // pose reuses RenderHost's CameraPose or a distinct type; reused here as
  // the minimal-invention choice since both describe a position+orientation
  // in the same scene.
  setListenerPose(pose: CameraPose): void;

  // OPEN(AH-audition-signature-tbd): plan names "auditionEmitter" without
  // specifying its parameter; an emitter index is the minimal reasonable
  // reading given glTF's emitters array.
  auditionEmitter(emitterIndex: number): void;

  suspend(): void;
  resume(): void;
  dispose(): void;
}
