import type { CameraPose } from "./value-types.js";

/**
 * AudioHost: KHR_audio_emitter/_environment authoring + playback. Lifts the
 * gltf-webgpu audio layer (spatial.ts + AudioSystem) per the reuse table;
 * this interface itself must stay implementation-agnostic.
 */
export interface AudioHost {
  /**
   * AH-001: gesture-gated — must not create/resume an AudioContext before a
   * user gesture.
   *
   * AH-init-signature-tbd (RESOLVED, M7, `audio-webaudio`): the gesture is
   * threaded through as an awaited app-side call site, not an internal
   * queue-until-gesture — `init()` itself has no gesture-detection logic at
   * all; it unconditionally creates the `AudioContext` the moment it's
   * called. AH-001 compliance is therefore a caller obligation: the app
   * must not call `init()` except from inside a real user-gesture handler
   * (e.g. the inspector's Audition button's `onClick`, or play-mode start).
   * This is the same "host provides the mechanism, caller provides the
   * gesture" split `WebAudioHost`'s doc comment describes for dropping the
   * lifted `AudioSystem`'s own Firefox retry-loop UX.
   */
  init(): Promise<void>;

  /**
   * AH-loademitters-shape-tbd (RESOLVED, M7, `audio-webaudio`): `json` is
   * the full glTF document — or the container shape
   * `{ json, binary?: ArrayBuffer | Uint8Array | null }` mirroring
   * `specs/render-host.md`'s RH-loadscene-shape-tbd resolution for
   * `RenderHost.loadScene` — not a pre-resolved emitters/environments
   * slice, because emitter↔node bindings and the active-listener/zone
   * rules need the `nodes`/`scenes` arrays alongside the two audio
   * extensions. Safe to call before `init()`: it only parses/stores;
   * buffer decoding and graph construction are deferred to `init()` if no
   * `AudioContext` exists yet. See `@gltf-studio/audio-webaudio`'s
   * `WebAudioHost.loadEmitters` doc comment for the full contract,
   * including idempotency and how `bufferView`-referenced audio resolves.
   */
  loadEmitters(json: unknown): Promise<void>;

  /**
   * AH-pointer-value-tbd (RESOLVED, M7, `audio-webaudio`): mirrors
   * `specs/render-host.md`'s RH-pointer-value-tbd resolution for
   * `RenderHost.applyPointer` — accepts the three-adapter's `number[] |
   * number` (audio pointers are always scalar-valued: gain, playbackRate, a
   * boolean-as-0/1 one-shot trigger, so only the first element of an array
   * is read); the engine-api type stays `unknown` since a future
   * non-Web-Audio implementation may differ. Any pointer outside the audio
   * extension families (i.e. anything RenderHost, not AudioHost, owns) — or
   * any call before `init()` — is a silent no-op, never a throw: PC-001's
   * fan-out (`SceneAdapter.applyPointer -> renderHost ‖ audioHost`) calls
   * both hosts unconditionally for every pointer write. See
   * `WebAudioHost.applyPointer`'s doc comment for the nonstandard
   * `/extensions/KHR_audio_emitter/sources/{i}/playing` one-shot-trigger
   * pointer it additionally matches — not part of the base
   * `KHR_audio_emitter` spec's Object Model, and not guaranteed portable to
   * another `AudioHost` implementation.
   */
  applyPointer(pointer: string, value: unknown): void;

  /**
   * AH-listenerpose-shape-tbd (RESOLVED, M7, `audio-webaudio`): reuses
   * `RenderHost`'s `CameraPose` rather than a distinct listener-pose type —
   * confirmed, not just left as a placeholder guess: both describe a
   * position+orientation in the same scene coordinate space, and the
   * intended v1 usage ("listener pose fed from the viewport camera
   * per-frame ONLY while playing") drives both hosts from the same one
   * camera-pose value every frame. This is also `AudioHost`'s sole
   * per-frame update hook — see `WebAudioHost.setListenerPose`'s doc
   * comment for what it recomputes (zone crossfade, doppler, cone/air
   * filtering) each call, replacing the lifted `AudioSystem`'s separate
   * camera-coupled `update()` method.
   */
  setListenerPose(pose: CameraPose): void;

  /**
   * AH-audition-signature-tbd (RESOLVED, M7, `audio-webaudio`): confirmed
   * as an emitter index (glTF's `extensions.KHR_audio_emitter.emitters`
   * array) — matches `specs/ux-inspector.md`'s UX-406 Audition (▶) control,
   * which is scoped to one node's one emitter. No-op (never throws) before
   * `init()`.
   */
  auditionEmitter(emitterIndex: number): void;

  suspend(): void;
  resume(): void;
  dispose(): void;
}
