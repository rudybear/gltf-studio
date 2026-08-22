// WebAudioHost: AudioHost (specs/engine-api.md AH-001/AH-002) implemented
// over the real Web Audio API.
//
// ADAPTED (M7) from /glTF-audio/gltf-webgpu/src/extensions/audio/index.ts's
// `AudioSystem` — the KHR_audio_emitter/KHR_audio_environment realization
// (PannerNode chains, listener bus, preset/parametric reverb with zone
// crossfades, per-emitter direct/reverb sends, doppler, distance/cone
// low-pass filtering) is the same machinery, restructured behind the
// `AudioHost` interface with three documented changes from the source:
//
//  1. Gesture-gated lifecycle (AH-001): the source's `start()` created the
//     `AudioContext` itself, synchronously. Here, `loadEmitters()` only
//     parses the extension JSON and (if a context already exists) decodes
//     buffers — it never creates one. `init()` is the sole context-creation
//     point, so the app can defer calling it until a real user gesture (the
//     inspector's Audition button, or play-mode start).
//  2. Explicit listener-pose interface instead of camera-coupling: the
//     source's `update(dt, cameraEye, cameraRotation, nodes)` took the
//     viewer's camera as its only pose source and additionally re-projected
//     every emitter's world position from live node matrices each frame.
//     `setListenerPose(pose: CameraPose)` (AH-002) is the sole per-frame
//     entry point here — it carries no assumption that the pose came from a
//     "camera" (engine-api's `CameraPose` is reused only because it already
//     describes a position+orientation in the same coordinate space, per
//     value-types.ts's own resolution note) and does the zone-crossfade/
//     doppler recompute the source's `update()` did. Emitter *positions*
//     are captured once, from the loaded document's static node transforms,
//     rather than re-read from a live scene graph every frame — AudioHost
//     has no other channel for scene-graph updates (RenderHost owns those),
//     so an emitter on an animated/pointer-moved node will not re-pan live
//     in v1. Documented gap, not silently dropped: see the class doc below.
//  3. Typed JSON instead of `any`: the source kept the whole glTF document
//     as `private readonly json: any`. The KHR_audio_emitter/
//     KHR_audio_environment slice this class actually reads is fully typed
//     below (`GltfAudioDocument` and friends).
//
// The startup "confirmation blip" oscillator and the Firefox
// resume-on-next-click retry loop the source had are both dropped per the
// same host-app-owns-UI reasoning as (1) above: this class's job is the
// audio graph, not autoplay-policy UX. `getDiagnostics()` (renamed here to
// match this package's naming, not part of the AudioHost interface) exposes
// enough state (`context.state`, buffer/emitter counts, last trigger) for a
// host app to build that UX itself if it wants to.
import type { AudioHost, CameraPose } from "@gltf-studio/engine-api";
import { mat4Invert, vec3TransformMat4, type Mat4, type Vec3 } from "./math.js";
import {
  combineCutoffs,
  computeAirAbsorptionCutoff,
  computeConeCutoff,
  computeDopplerPitch,
  quatRotate,
  resolveReverbParams,
  sampleDistanceCurve,
  selectEnvironment,
  type DopplerProperties,
  type ReverbProperties,
  type ZoneBinding
} from "./spatial.js";

// ---------------------------------------------------------------------------
// Typed KHR_audio_emitter / KHR_audio_environment JSON slice.
// ---------------------------------------------------------------------------

export interface AudioDataDef {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

export interface SourceDef {
  audio?: number;
  gain?: number;
  autoplay?: boolean;
  loop?: boolean;
  playbackRate?: number;
}

export interface PositionalDef {
  shapeType?: string;
  distanceModel?: string;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  extensions?: {
    KHR_audio_environment?: {
      spatializationModel?: string;
      distanceCurve?: number[];
      airAbsorption?: { enabled?: boolean; cutoffAtMaxDistance?: number };
      coneOuterCutoff?: number;
      dopplerEnabled?: boolean;
    };
  };
}

export interface EmitterDef {
  type: string;
  gain?: number;
  sources?: number[];
  positional?: PositionalDef;
  name?: string;
  extensions?: {
    KHR_audio_environment?: { directLevel?: number; reverbLevel?: number; environment?: number };
  };
}

export interface ListenerDef {
  name?: string;
  gain?: number;
  spatializationModel?: string;
  interauralDistance?: number;
}

export interface EnvironmentDef {
  name?: string;
  reverb?: ReverbProperties;
  doppler?: DopplerProperties;
}

interface AudioEmitterExtension {
  audio?: AudioDataDef[];
  sources?: SourceDef[];
  emitters?: EmitterDef[];
}

interface AudioEnvironmentExtension {
  listeners?: ListenerDef[];
  environments?: EnvironmentDef[];
}

interface GltfNodeAudio {
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  camera?: number;
  extensions?: {
    KHR_audio_emitter?: { emitter?: number; emitters?: number[] };
    KHR_audio_environment?: {
      listener?: number;
      environment?: number;
      shape?: { type: string; size?: Vec3; radius?: number };
      blendDistance?: number;
      priority?: number;
    };
  };
}

interface GltfSceneAudio {
  extensions?: {
    KHR_audio_emitter?: { emitters?: number[] };
    KHR_audio_environment?: { activeListener?: number; environment?: number };
  };
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
}

interface GltfBuffer {
  uri?: string;
  byteLength: number;
}

/** The minimal glTF document shape `loadEmitters` reads (AH-loademitters-shape-tbd, resolved below). */
export interface GltfAudioDocument {
  scene?: number;
  scenes?: GltfSceneAudio[];
  nodes?: GltfNodeAudio[];
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  extensions?: {
    KHR_audio_emitter?: AudioEmitterExtension;
    KHR_audio_environment?: AudioEnvironmentExtension;
  };
}

/**
 * AH-loademitters-shape-tbd (RESOLVED, see specs/engine-api.md): mirrors
 * RH-loadscene-shape-tbd's resolution for `RenderHost.loadScene` — accepts
 * either a container shape (`{ json, binary }`, binary chunk resolved by the
 * host app, e.g. from a GLB's BIN chunk) or a bare, self-contained glTF JSON
 * document (buffers inlined as base64 `data:` URIs). Both are read
 * read-only; this package does not re-encode/round-trip a container the way
 * `engine-three`'s `loadScene` does. `bufferView`-referenced audio (the
 * common case for a project already loaded into `editor-core`'s
 * `EditorDocument`) resolves against `binary`; a `data:` URI `audio[].uri`
 * resolves without one. A non-`data:` external URI is NOT fetched in v1 (no
 * network access from this package) — such an entry silently fails to
 * decode, the same soft-fail `decodeSingle` already applies to a malformed
 * buffer.
 */
export type LoadEmittersInput = GltfAudioDocument | { json: GltfAudioDocument; binary?: ArrayBuffer | Uint8Array | null };

function isGltfAudioDocument(value: unknown): value is GltfAudioDocument {
  return typeof value === "object" && value !== null;
}

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizeLoadInput(value: unknown): { doc: GltfAudioDocument; binary: ArrayBuffer | null } {
  if (value && typeof value === "object" && "json" in (value as Record<string, unknown>)) {
    const container = value as { json: unknown; binary?: ArrayBuffer | Uint8Array | null };
    if (!isGltfAudioDocument(container.json)) {
      throw new TypeError("WebAudioHost.loadEmitters: container shape requires a glTF JSON object at .json");
    }
    return { doc: container.json, binary: container.binary ? toArrayBuffer(container.binary) : null };
  }
  if (isGltfAudioDocument(value)) {
    return { doc: value, binary: null };
  }
  throw new TypeError("WebAudioHost.loadEmitters: expected a glTF document, or { json, binary }");
}

function decodeDataUri(uri: string): ArrayBuffer | undefined {
  const match = uri.match(/^data:[^,]*;base64,(.*)$/s);
  if (!match) {
    return undefined;
  }
  const binaryString = atob(match[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------

interface EmitterInstance {
  emitterIndex: number;
  nodeIndex: number | null;
  def: EmitterDef;
  input: GainNode;
  panner: PannerNode | null;
  filter: BiquadFilterNode | null;
  distanceGain: GainNode | null;
  directGain: GainNode;
  sendGain: GainNode;
  sources: Array<{ sourceIndex: number; node: AudioBufferSourceNode; gain: GainNode; basePlaybackRate: number }>;
  staticPosition: Vec3;
  staticForward: Vec3;
}

interface EnvironmentBus {
  environmentIndex: number;
  def: EnvironmentDef;
  input: GainNode;
  gate: GainNode;
  returnGain: GainNode;
}

const RAD_TO_DEG = 180 / Math.PI;
const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

function generateReverbImpulse(
  context: BaseAudioContext,
  params: {
    decayTime: number;
    decayHFRatio: number;
    reflectionsGain: number;
    reflectionsDelay: number;
    reverbGain: number;
    reverbDelay: number;
    diffusion: number;
    density: number;
  }
): AudioBuffer {
  const rate = context.sampleRate;
  const tailStart = params.reflectionsDelay + params.reverbDelay;
  const length = Math.max(rate * 0.05, Math.floor(rate * (tailStart + params.decayTime)));
  const buffer = context.createBuffer(2, length, rate);
  const decayRate = 6.908 / Math.max(params.decayTime, 0.05);
  const cutoff = Math.min(Math.max(20000 * params.decayHFRatio, 200), rate * 0.45);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  const occupancy = 0.3 + 0.7 * params.density;

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const tapCount = 6;
    for (let k = 0; k < tapCount; k += 1) {
      const at = Math.floor(rate * (params.reflectionsDelay + k * 0.0063 * (1 + channel * 0.17)));
      if (at < length) {
        const polarity = (k + channel) % 2 === 0 ? 1 : -1;
        data[at] += polarity * params.reflectionsGain * 0.7 * (1 - k / tapCount);
      }
    }
    let lowpassState = 0;
    const start = Math.floor(rate * tailStart);
    for (let i = start; i < length; i += 1) {
      const t = (i - start) / rate;
      if (Math.random() > occupancy) {
        continue;
      }
      const white = Math.random() * 2 - 1;
      lowpassState += alpha * (white - lowpassState);
      data[i] += lowpassState * Math.exp(-t * decayRate) * params.reverbGain;
    }
  }
  return buffer;
}

function trsToMatrix(node: GltfNodeAudio): Mat4 {
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? IDENTITY_QUAT;
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  const out = new Float32Array(16);
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}

function matrixPosition(matrix: Mat4): Vec3 {
  return [matrix[12], matrix[13], matrix[14]];
}

function matrixForward(matrix: Mat4): Vec3 {
  const x = -matrix[8];
  const y = -matrix[9];
  const z = -matrix[10];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/**
 * AudioHost over the Web Audio API. See the file header for the three
 * documented departures from the lifted `AudioSystem`.
 *
 * KNOWN GAP: emitter panner positions are computed once (from the node
 * transforms present when `loadEmitters`/`init` ran) rather than tracked
 * live against a moving/animated node — AudioHost has no scene-graph feed
 * independent of the pointer families it understands (`applyPointer` only
 * matches audio-extension pointers, per AH-002's "no additional
 * emitter-authoring methods"; node `/translation` etc. pointers are
 * RenderHost's domain in the `SceneAdapter.applyPointer -> renderHost ‖
 * audioHost` fan-out, PC-001). Revisiting this needs either a fourth
 * AudioHost method (widening AH-002) or a RenderHost->AudioHost world-
 * matrix feed — left as a follow-up, not attempted here.
 */
/**
 * Constructor options for `WebAudioHost` — NOT part of the `AudioHost`
 * interface (AH-002 fixes that surface exactly at `init/loadEmitters/
 * applyPointer/setListenerPose/auditionEmitter` + lifecycle); this is a
 * concrete-class-only extension point, the same "interface unchanged, one
 * concrete class widened" shape `getDiagnostics()`/`getEmitterPosition()`
 * already established as non-interface extras.
 */
export interface WebAudioHostOptions {
  /**
   * Resolves a non-`data:`, non-`http(s)://` audio clip uri (typically a
   * project-relative path, e.g. a `KHR_audio_emitter.audio[]` entry kept as
   * a URI REFERENCE rather than embedded) to raw bytes. The app layer is
   * expected to back this with its own file-map/granted-folder machinery
   * (`@gltf-studio/storage`'s `resolveUrisFromDirectory`) — `WebAudioHost`
   * has no filesystem access of its own. Returning `null`/`undefined` (no
   * folder granted yet, or the file genuinely isn't there) is NOT an error:
   * `decodeSingle` treats it exactly like any other undecodable clip
   * (silently skipped from the built audio graph), surfaced only via
   * `getUnresolvedAudioUris()` for an honest "unresolved" UI state — never a
   * thrown exception or a console error. An absolute `http(s)://` uri is
   * ALWAYS fetched directly by `WebAudioHost` itself (a real `fetch()`; a
   * network/CORS failure is caught and treated as unresolved the same way)
   * and never routed through this callback.
   */
  resolveAudioUri?: (uri: string) => Promise<ArrayBuffer | null | undefined>;
}

export class WebAudioHost implements AudioHost {
  private readonly resolveAudioUri?: (uri: string) => Promise<ArrayBuffer | null | undefined>;
  private unresolvedClipUris = new Set<string>();
  /**
   * Cache for a resolved EXTERNAL (non-`data:`) uri's bytes, deliberately
   * SEPARATE from `decodedUriBuffers` below (which `loadEmitters` clears on
   * every call — cheap to redo for a local base64 `data:` decode, but an
   * external resolution can mean a real network `fetch()` or an async
   * directory-handle lookup). `attachAudioHost` reloads on EVERY
   * `HistoryStack.onApply` (i.e. on every unrelated document edit, not just
   * audio ones) — without this separate, never-auto-cleared cache, every
   * edit anywhere in the document would re-fetch/re-resolve every
   * uri-referenced clip. Cleared only in `dispose()`.
   */
  private externalUriCache = new Map<string, ArrayBuffer>();

  constructor(options: WebAudioHostOptions = {}) {
    this.resolveAudioUri = options.resolveAudioUri;
  }

  private context: AudioContext | null = null;
  private listenerBus: GainNode | null = null;
  private sendBus: GainNode | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private emitterInstances: EmitterInstance[] = [];
  private environmentBuses = new Map<number, EnvironmentBus>();
  private zones: ZoneBinding[] = [];
  private defaultEnvironmentIndex: number | undefined;
  private listenerDef: ListenerDef | undefined;
  private previousListenerPose: { position: Vec3; time: number } | null = null;
  private lastTrigger = "none";

  private doc: GltfAudioDocument | null = null;
  private binary: ArrayBuffer | null = null;
  private decodedUriBuffers = new Map<string, ArrayBuffer>();
  private suspended = false;

  get isInitialized(): boolean {
    return this.context !== null;
  }

  /** AH-001: creates/resumes the AudioContext. Call only from a user-gesture handler. */
  async init(): Promise<void> {
    if (this.context) {
      if (this.context.state !== "running") {
        await this.context.resume().catch(() => undefined);
      }
      return;
    }
    this.context = new AudioContext();
    this.listenerBus = this.context.createGain();
    this.listenerBus.connect(this.context.destination);
    this.sendBus = this.context.createGain();
    if (this.doc) {
      await this.buildFromDocument(this.doc);
    }
    await this.context.resume().catch(() => undefined);
  }

  /**
   * AH-loademitters-shape-tbd (RESOLVED, see specs/engine-api.md): `json` is
   * the full glTF document (or any object carrying the same
   * `extensions.KHR_audio_emitter`/`KHR_audio_environment`/`nodes`/`scenes`
   * shape) — not a pre-resolved slice — because emitter↔node bindings and
   * the active-listener/zone rules all need the node/scene arrays alongside
   * the two audio extensions. Safe to call before `init()` (AH-001): it
   * only parses/stores; buffer decoding and graph construction are deferred
   * to `init()` if no AudioContext exists yet, or run immediately (replacing
   * any previously built graph) if one already does. Idempotent per AH-002's
   * contract obligation: calling it twice with the same input rebuilds
   * cleanly rather than duplicating emitter instances.
   */
  async loadEmitters(json: unknown): Promise<void> {
    const { doc, binary } = normalizeLoadInput(json);
    this.doc = doc;
    this.binary = binary;
    this.decodedUriBuffers.clear();
    if (this.context) {
      await this.buildFromDocument(doc);
    }
  }

  /**
   * AH-pointer-value-tbd (RESOLVED, see specs/engine-api.md): `value` is the
   * live-pointer numeric tuple engine-three's own `PointerValue` resolution
   * already settled on for RenderHost (`number[] | number`) — audio
   * pointers here are always scalar-valued (gain, playbackRate, a
   * boolean-as-0/1 trigger), so only the first element is read. Silently
   * ignores (returns without effect) any pointer outside the audio
   * extension families or any call before `init()` — the fan-out
   * (PC-001) calls both hosts unconditionally, so non-audio pointers must
   * be a no-op here, not a throw.
   */
  applyPointer(pointer: string, value: unknown): void {
    if (!this.context) {
      return;
    }
    const scalar = Array.isArray(value) ? Number(value[0]) : Number(value);
    if (!Number.isFinite(scalar)) {
      return;
    }
    const time = this.context.currentTime;

    let match = pointer.match(/^\/extensions\/KHR_audio_emitter\/emitters\/(\d+)\/gain$/);
    if (match) {
      const index = Number(match[1]);
      for (const instance of this.emitterInstances) {
        if (instance.emitterIndex === index) {
          instance.input.gain.setTargetAtTime(scalar, time, 0.02);
        }
      }
      return;
    }

    // NONSTANDARD: `/sources/{i}/playing` is not part of the base
    // KHR_audio_emitter spec — no such pointer exists in the extension's
    // Object Model definition. It is this project's (and the lifted
    // AudioSystem's — see the upstream repo's gap-analysis feedback item
    // E1) prototype for one-shot playback triggering from KHR_interactivity/
    // KHR_animation_pointer: writing a truthy value (re)fires every emitter
    // instance referencing the source; falsy stops it. Kept because there is
    // currently no standard alternative for "trigger this one-shot sample"
    // and the drum-kit/interactivity use case needs it — but it should NOT
    // be treated as portable to another KHR_audio_emitter-only
    // implementation. See specs/engine-api.md's AH-002 note.
    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/sources\/(\d+)\/playing$/);
    if (match) {
      const fired = this.triggerSource(Number(match[1]), scalar > 0.5);
      this.lastTrigger = `source ${match[1]} (${fired} voice${fired === 1 ? "" : "s"})`;
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/sources\/(\d+)\/(gain|playbackRate)$/);
    if (match) {
      const index = Number(match[1]);
      const property = match[2];
      for (const instance of this.emitterInstances) {
        for (const source of instance.sources) {
          if (source.sourceIndex !== index) {
            continue;
          }
          if (property === "gain") {
            source.gain.gain.setTargetAtTime(scalar, time, 0.02);
          } else {
            source.basePlaybackRate = scalar;
            source.node.playbackRate.setTargetAtTime(scalar, time, 0.02);
          }
        }
      }
      return;
    }

    // Emitter/environment authoring (specs/ux-inspector.md UX-419/UX-423,
    // specs/engine-api.md's extended AH-pointer-value-tbd note): five plain
    // PannerNode attributes (NOT AudioParams in the Web Audio API — no
    // setTargetAtTime automation applies, or is needed, for these) applied
    // directly on the positional emitter's own live panner, so a drag on the
    // Inspector's ref/max distance or cone fields updates spatialization
    // with no full-graph rebuild. Cone angles are glTF radians; PannerNode's
    // own coneInnerAngle/coneOuterAngle are degrees. Deliberately NOT
    // included here: distanceModel/rolloffFactor (rolloffFactor interacts
    // with buildEmitterChain's "custom distance curve" special case, which
    // zeroes it and adds a distanceGain node — a live single-field write
    // could silently desync from that branch) and shapeType (switching
    // omnidirectional<->cone changes whether the panner's cone fields apply
    // at all) — those rely on the reload fallback (see this file's header
    // and specs/ux-inspector.md's UX-423) like every other topology field.
    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/emitters\/(\d+)\/positional\/(refDistance|maxDistance)$/);
    if (match) {
      const index = Number(match[1]);
      const property = match[2] as "refDistance" | "maxDistance";
      for (const instance of this.emitterInstances) {
        if (instance.emitterIndex === index && instance.panner) {
          instance.panner[property] = scalar;
        }
      }
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/emitters\/(\d+)\/positional\/(coneInnerAngle|coneOuterAngle)$/);
    if (match) {
      const index = Number(match[1]);
      const property = match[2] as "coneInnerAngle" | "coneOuterAngle";
      for (const instance of this.emitterInstances) {
        if (instance.emitterIndex === index && instance.panner) {
          instance.panner[property] = scalar * RAD_TO_DEG;
        }
      }
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/emitters\/(\d+)\/positional\/coneOuterGain$/);
    if (match) {
      const index = Number(match[1]);
      for (const instance of this.emitterInstances) {
        if (instance.emitterIndex === index && instance.panner) {
          instance.panner.coneOuterGain = scalar;
        }
      }
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_emitter\/emitters\/(\d+)\/extensions\/KHR_audio_environment\/(directLevel|reverbLevel)$/);
    if (match) {
      const index = Number(match[1]);
      const property = match[2];
      for (const instance of this.emitterInstances) {
        if (instance.emitterIndex === index) {
          const target = property === "directLevel" ? instance.directGain : instance.sendGain;
          target.gain.setTargetAtTime(scalar, time, 0.02);
        }
      }
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_environment\/environments\/(\d+)\/reverb\/mix$/);
    if (match) {
      const bus = this.environmentBuses.get(Number(match[1]));
      bus?.returnGain.gain.setTargetAtTime(scalar, time, 0.02);
      return;
    }

    match = pointer.match(/^\/extensions\/KHR_audio_environment\/listeners\/(\d+)\/gain$/);
    if (match && this.listenerBus) {
      this.listenerBus.gain.setTargetAtTime(scalar, time, 0.02);
    }
  }

  /**
   * AH-listenerpose-shape-tbd (RESOLVED, see specs/engine-api.md): reuses
   * `RenderHost`'s `CameraPose` (position + glTF-order quaternion + optional
   * target) rather than inventing a distinct listener-pose type — both
   * describe a position+orientation in the same scene coordinate space, and
   * a host app driving both from one viewport camera (the intended v1
   * usage: "listener pose fed from the viewport camera per-frame only while
   * playing") would otherwise convert between two structurally identical
   * shapes for no benefit. This is also this class's per-frame update hook
   * (see the file header's item 2): each call recomputes listener velocity
   * (for doppler), zone crossfade weights, and per-emitter cone/air-
   * absorption filtering and doppler pitch against the new pose.
   */
  setListenerPose(pose: CameraPose): void {
    if (!this.context) {
      return;
    }
    const context = this.context;
    const now = typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000;
    const position = pose.position;
    const rotation = pose.rotation;

    const forward = quatRotate([0, 0, -1], rotation);
    const up = quatRotate([0, 1, 0], rotation);
    const listener = context.listener;
    if ("positionX" in listener) {
      listener.positionX.value = position[0];
      listener.positionY.value = position[1];
      listener.positionZ.value = position[2];
      listener.forwardX.value = forward[0];
      listener.forwardY.value = forward[1];
      listener.forwardZ.value = forward[2];
      listener.upX.value = up[0];
      listener.upY.value = up[1];
      listener.upZ.value = up[2];
    }

    const dt = this.previousListenerPose ? Math.max(now - this.previousListenerPose.time, 1e-4) : 1e-4;
    const listenerVelocity: Vec3 = this.previousListenerPose
      ? [
          (position[0] - this.previousListenerPose.position[0]) / dt,
          (position[1] - this.previousListenerPose.position[1]) / dt,
          (position[2] - this.previousListenerPose.position[2]) / dt
        ]
      : [0, 0, 0];
    this.previousListenerPose = { position, time: now };

    const selection = selectEnvironment(this.zones, this.defaultEnvironmentIndex, position, (zone, world) => {
      const node = this.doc?.nodes?.[zone.nodeIndex];
      if (!node) {
        return world;
      }
      const inverse = mat4Invert(trsToMatrix(node));
      return inverse ? vec3TransformMat4(inverse, world) : world;
    });
    const activeDoppler = typeof selection.environmentIndex === "number"
      ? this.environmentBuses.get(selection.environmentIndex)?.def.doppler
      : undefined;
    for (const [index, bus] of this.environmentBuses) {
      let weight = 0;
      if (index === selection.environmentIndex) {
        weight = 1 - selection.blendToOutside;
      }
      if (index === selection.outsideEnvironmentIndex && selection.blendToOutside > 0) {
        weight = Math.max(weight, selection.blendToOutside);
      }
      bus.gate.gain.setTargetAtTime(weight, context.currentTime, 0.05);
    }

    for (const instance of this.emitterInstances) {
      const emitterPosition = instance.staticPosition;
      const forwardDir = instance.staticForward;
      const positional = instance.def.positional;
      const envProps = positional?.extensions?.KHR_audio_environment;
      const dx = position[0] - emitterPosition[0];
      const dy = position[1] - emitterPosition[1];
      const dz = position[2] - emitterPosition[2];
      const distance = Math.hypot(dx, dy, dz);

      if (instance.distanceGain && envProps?.distanceCurve && positional) {
        const gain = sampleDistanceCurve(
          envProps.distanceCurve,
          positional.refDistance ?? 1,
          positional.maxDistance ?? 0,
          distance
        );
        instance.distanceGain.gain.setTargetAtTime(gain, context.currentTime, 0.03);
      }

      if (instance.filter && positional) {
        let cutoff = 20000;
        const air = envProps?.airAbsorption;
        if (air?.enabled) {
          cutoff = combineCutoffs(
            cutoff,
            computeAirAbsorptionCutoff(positional.refDistance ?? 1, positional.maxDistance ?? 0, air.cutoffAtMaxDistance ?? 5000, distance)
          );
        }
        if (typeof envProps?.coneOuterCutoff === "number" && positional.shapeType === "cone" && distance > 0) {
          const toListener: Vec3 = [dx / distance, dy / distance, dz / distance];
          const dot = forwardDir[0] * toListener[0] + forwardDir[1] * toListener[1] + forwardDir[2] * toListener[2];
          const offAxis = Math.acos(Math.min(Math.max(dot, -1), 1));
          cutoff = combineCutoffs(
            cutoff,
            computeConeCutoff(positional.coneInnerAngle ?? Math.PI * 2, positional.coneOuterAngle ?? Math.PI * 2, envProps.coneOuterCutoff, offAxis)
          );
        }
        instance.filter.frequency.setTargetAtTime(cutoff, context.currentTime, 0.03);
      }

      const dopplerEnabled = activeDoppler?.enabled && envProps?.dopplerEnabled !== false && instance.def.type === "positional";
      const emitterVelocity: Vec3 = [0, 0, 0]; // static emitter positions in v1 (see class doc's KNOWN GAP)
      const pitch = dopplerEnabled ? computeDopplerPitch(activeDoppler, position, listenerVelocity, emitterPosition, emitterVelocity) : 1.0;
      for (const source of instance.sources) {
        source.node.playbackRate.setTargetAtTime(source.basePlaybackRate * pitch, context.currentTime, 0.05);
      }
    }
  }

  /**
   * AH-audition-signature-tbd (RESOLVED, see specs/engine-api.md): takes an
   * emitter index (glTF's `extensions.KHR_audio_emitter.emitters` array),
   * matching UX-406's "Audition (▶)" inspector control, which is scoped to
   * one node's one emitter. Fires every source bound to that emitter once
   * (looping sources still fire once — audition is a preview, not
   * play-mode). No-op (does not throw) if not yet initialized, matching the
   * AudioHost contract obligation.
   */
  auditionEmitter(emitterIndex: number): void {
    if (!this.context) {
      return;
    }
    const instance = this.emitterInstances.find((candidate) => candidate.emitterIndex === emitterIndex);
    if (!instance) {
      return;
    }
    for (const sourceIndex of instance.def.sources ?? []) {
      this.playOneShot(instance, sourceIndex);
    }
  }

  suspend(): void {
    if (!this.context || this.suspended) {
      return;
    }
    this.suspended = true;
    void this.context.suspend().catch(() => undefined);
  }

  resume(): void {
    if (!this.context) {
      return;
    }
    this.suspended = false;
    void this.context.resume().catch(() => undefined);
  }

  dispose(): void {
    for (const instance of this.emitterInstances) {
      for (const source of instance.sources) {
        try {
          source.node.stop();
        } catch {
          // never started
        }
      }
    }
    this.emitterInstances = [];
    this.environmentBuses.clear();
    this.zones = [];
    this.buffers.clear();
    this.externalUriCache.clear();
    this.unresolvedClipUris.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.listenerBus = null;
    this.sendBus = null;
    this.previousListenerPose = null;
    this.suspended = false;
  }

  /** Not part of the AudioHost interface (AH-002 fixes the surface exactly) — a diagnostics-only extra, see the file header. */
  getDiagnostics(): string {
    if (!this.context) {
      return "audio idle";
    }
    return `audio ${this.context.state}, ${this.buffers.size} buffer(s), ${this.emitterInstances.length} emitter(s), last trigger: ${this.lastTrigger}`;
  }

  /**
   * Not part of the AudioHost interface (AH-002 fixes the surface exactly)
   * — a diagnostics-only extra, mirroring `getDiagnostics`'s own rationale.
   * specs/ux-inspector.md UX-423: exposes the exact `staticPosition` a
   * positional emitter's `PannerNode` was last placed at — the one piece of
   * `WebAudioHost`'s internal state an e2e test needs to confirm "an
   * EDITOR-driven node move (gizmo drag or Inspector Transform-section
   * edit) re-derives the emitter's world position via the `attachAudioHost`
   * reload path" without reaching into a private field. Returns `null` for
   * an unknown emitter index or a `type: "global"` emitter (no panner, no
   * position).
   */
  getEmitterPosition(emitterIndex: number): [number, number, number] | null {
    const instance = this.emitterInstances.find((candidate) => candidate.emitterIndex === emitterIndex);
    if (!instance || !instance.panner) {
      return null;
    }
    return [...instance.staticPosition];
  }

  /**
   * Not part of the AudioHost interface (AH-002 fixes the surface exactly)
   * — a diagnostics-only extra, mirroring `getDiagnostics`/`getEmitterPosition`'s
   * own rationale. Lists every `audio[].uri` this host's most recent
   * `loadEmitters` rebuild could NOT resolve to playable bytes (an external
   * uri with no folder-access grant yet, a `fetch()`/CORS failure, or a
   * genuinely missing file) — the source of truth the Assets > Audio Clips
   * tab's "unresolved" badge reads, so that state can never drift from what
   * actually failed to decode. Recomputed fresh on every `loadEmitters` call
   * (never accumulates stale entries across reloads); empty when nothing is
   * unresolved, including before any document with a `uri`-referenced clip
   * has ever loaded.
   */
  getUnresolvedAudioUris(): string[] {
    return [...this.unresolvedClipUris];
  }

  // -------------------------------------------------------------------------

  private async buildFromDocument(doc: GltfAudioDocument): Promise<void> {
    const context = this.context;
    if (!context || !this.listenerBus || !this.sendBus) {
      return;
    }
    // Idempotent per AH-002: dispose any previously built graph before
    // rebuilding, so calling loadEmitters twice never duplicates emitters.
    for (const instance of this.emitterInstances) {
      for (const source of instance.sources) {
        try {
          source.node.stop();
        } catch {
          // never started
        }
      }
    }
    this.emitterInstances = [];
    this.environmentBuses.clear();
    this.zones = [];
    this.buffers.clear();

    const emitterExt = doc.extensions?.KHR_audio_emitter;
    if (!emitterExt) {
      return;
    }
    const envExt = doc.extensions?.KHR_audio_environment ?? {};

    this.listenerDef = this.selectListener(doc, envExt.listeners);
    this.listenerBus.gain.value = this.listenerDef?.gain ?? 1.0;

    const environments = envExt.environments ?? [];
    for (let i = 0; i < environments.length; i += 1) {
      this.environmentBuses.set(i, this.buildEnvironmentBus(context, i, environments[i]));
    }
    this.collectZonesAndDefault(doc);

    await this.decodeAudioData(context, emitterExt.audio ?? []);
    this.buildEmitterInstances(context, doc, emitterExt);
  }

  private selectListener(doc: GltfAudioDocument, listeners: ListenerDef[] | undefined): ListenerDef | undefined {
    if (!listeners || listeners.length === 0) {
      return undefined;
    }
    const scenes = doc.scenes ?? [];
    const sceneIndex = doc.scene ?? 0;
    const pinned = scenes[sceneIndex]?.extensions?.KHR_audio_environment?.activeListener;
    if (typeof pinned === "number" && listeners[pinned]) {
      return listeners[pinned];
    }
    const nodes = doc.nodes ?? [];
    let firstBinding: ListenerDef | undefined;
    for (const node of nodes) {
      const index = node.extensions?.KHR_audio_environment?.listener;
      if (typeof index !== "number" || !listeners[index]) {
        continue;
      }
      if (typeof node.camera === "number") {
        return listeners[index];
      }
      firstBinding = firstBinding ?? listeners[index];
    }
    return firstBinding ?? listeners[0];
  }

  private collectZonesAndDefault(doc: GltfAudioDocument): void {
    const scenes = doc.scenes ?? [];
    const sceneIndex = doc.scene ?? 0;
    const sceneEnv = scenes[sceneIndex]?.extensions?.KHR_audio_environment?.environment;
    this.defaultEnvironmentIndex = typeof sceneEnv === "number" ? sceneEnv : undefined;

    const nodes = doc.nodes ?? [];
    for (let i = 0; i < nodes.length; i += 1) {
      const binding = nodes[i].extensions?.KHR_audio_environment;
      if (!binding || typeof binding.environment !== "number" || !binding.shape) {
        continue;
      }
      this.zones.push({
        nodeIndex: i,
        environmentIndex: binding.environment,
        shape: binding.shape,
        blendDistance: binding.blendDistance ?? 0,
        priority: binding.priority ?? 0
      });
    }
  }

  private buildEnvironmentBus(context: AudioContext, index: number, def: EnvironmentDef): EnvironmentBus {
    const params = resolveReverbParams(def.reverb);
    const input = context.createGain();
    const gate = context.createGain();
    gate.gain.value = 0;
    this.sendBus!.connect(gate);
    gate.connect(input);
    const returnGain = context.createGain();
    returnGain.gain.value = params.mix;
    returnGain.connect(this.listenerBus!);

    const convolver = context.createConvolver();
    if (typeof def.reverb?.normalize === "boolean") {
      convolver.normalize = def.reverb.normalize;
    }
    convolver.buffer = generateReverbImpulse(context, params);
    input.connect(convolver);
    convolver.connect(returnGain);
    return { environmentIndex: index, def, input, gate, returnGain };
  }

  /** Resolves a `bufferViews[index]` against `this.binary` (container shape) — see `LoadEmittersInput`'s doc comment. */
  private resolveBufferView(index: number): ArrayBuffer | undefined {
    const doc = this.doc;
    const view = doc?.bufferViews?.[index];
    if (!view) {
      return undefined;
    }
    const bufferDef = doc?.buffers?.[view.buffer];
    const offset = view.byteOffset ?? 0;
    if (bufferDef?.uri) {
      const cached = this.decodedUriBuffers.get(bufferDef.uri);
      const decoded = cached ?? decodeDataUri(bufferDef.uri);
      if (!decoded) {
        return undefined;
      }
      if (!cached) {
        this.decodedUriBuffers.set(bufferDef.uri, decoded);
      }
      return decoded.slice(offset, offset + view.byteLength);
    }
    if (!this.binary) {
      return undefined;
    }
    return this.binary.slice(offset, offset + view.byteLength);
  }

  private async decodeAudioData(context: AudioContext, audio: AudioDataDef[]): Promise<void> {
    // Cleared per rebuild (not per-entry) so a clip that was unresolved on a
    // prior `loadEmitters` call (e.g. before a folder-access grant) is
    // retried fresh on every reload rather than sticking as stale — the same
    // "idempotent rebuild" contract `this.buffers`'s index-cache already
    // gives every OTHER clip (a previously-unresolved entry is simply never
    // cached in `this.buffers`, so `decodeSingle` always retries it below).
    this.unresolvedClipUris.clear();
    await Promise.all(audio.map((_, index) => this.decodeSingle(context, audio, index)));
  }

  /**
   * Resolves a non-`data:` `audio[].uri` — an absolute `http(s)://` uri is
   * fetched directly (honest CORS/network failure -> `undefined`); anything
   * else is delegated to `this.resolveAudioUri` (the app-supplied
   * project-folder resolver) when one was given at construction. Caches a
   * successful resolution by uri (`externalUriCache`, a cache deliberately
   * never cleared by `loadEmitters` itself — see its own doc comment) so a
   * fetch/directory-lookup never repeats for the same uri across
   * `loadEmitters` reloads.
   */
  private async resolveExternalUri(uri: string): Promise<ArrayBuffer | undefined> {
    const cached = this.externalUriCache.get(uri);
    if (cached) {
      return cached;
    }
    let resolved: ArrayBuffer | undefined;
    try {
      if (/^https?:\/\//i.test(uri)) {
        const response = await fetch(uri);
        if (response.ok) {
          resolved = await response.arrayBuffer();
        }
      } else if (this.resolveAudioUri) {
        resolved = (await this.resolveAudioUri(uri)) ?? undefined;
      }
    } catch {
      resolved = undefined; // network error, CORS rejection, or a resolver callback throwing — all treated as "unresolved", never propagated.
    }
    if (resolved) {
      this.externalUriCache.set(uri, resolved);
    }
    return resolved;
  }

  private async decodeSingle(context: AudioContext, audio: AudioDataDef[], index: number): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(index);
    if (cached) {
      return cached;
    }
    const def = audio[index];
    if (!def) {
      return undefined;
    }
    try {
      let raw: ArrayBuffer | undefined;
      let isExternalUri = false;
      if (typeof def.bufferView === "number") {
        raw = this.resolveBufferView(def.bufferView);
      } else if (def.uri) {
        raw = decodeDataUri(def.uri);
        if (!raw) {
          isExternalUri = true;
          raw = await this.resolveExternalUri(def.uri);
        }
      }
      if (!raw) {
        if (isExternalUri && def.uri) {
          this.unresolvedClipUris.add(def.uri); // an honest "couldn't resolve this reference" state, not a thrown error — see getUnresolvedAudioUris().
        }
        return undefined;
      }
      const buffer = await context.decodeAudioData(raw.slice(0));
      this.buffers.set(index, buffer);
      return buffer;
    } catch {
      return undefined;
    }
  }

  private buildEmitterInstances(context: AudioContext, doc: GltfAudioDocument, emitterExt: AudioEmitterExtension): void {
    const bindings: Array<{ emitterIndex: number; nodeIndex: number | null }> = [];
    const nodes = doc.nodes ?? [];
    for (let i = 0; i < nodes.length; i += 1) {
      const ext = nodes[i].extensions?.KHR_audio_emitter;
      if (!ext) {
        continue;
      }
      const list = Array.isArray(ext.emitters) ? ext.emitters : typeof ext.emitter === "number" ? [ext.emitter] : [];
      for (const emitterIndex of list) {
        bindings.push({ emitterIndex, nodeIndex: i });
      }
    }
    const scenes = doc.scenes ?? [];
    const sceneExt = scenes[doc.scene ?? 0]?.extensions?.KHR_audio_emitter;
    for (const emitterIndex of sceneExt?.emitters ?? []) {
      bindings.push({ emitterIndex, nodeIndex: null });
    }

    for (const binding of bindings) {
      const def = (emitterExt.emitters ?? [])[binding.emitterIndex];
      if (!def) {
        continue;
      }
      const node = binding.nodeIndex !== null ? nodes[binding.nodeIndex] : undefined;
      const matrix = node ? trsToMatrix(node) : null;
      const instance = this.buildEmitterChain(
        context,
        binding.emitterIndex,
        binding.nodeIndex,
        def,
        emitterExt.sources ?? [],
        matrix ? matrixPosition(matrix) : [0, 0, 0],
        matrix ? matrixForward(matrix) : [0, 0, -1]
      );
      this.emitterInstances.push(instance);
    }
  }

  private buildEmitterChain(
    context: AudioContext,
    emitterIndex: number,
    nodeIndex: number | null,
    def: EmitterDef,
    sources: SourceDef[],
    staticPosition: Vec3,
    staticForward: Vec3
  ): EmitterInstance {
    const input = context.createGain();
    input.gain.value = def.gain ?? 1.0;

    let tail: AudioNode = input;
    let filter: BiquadFilterNode | null = null;
    let distanceGain: GainNode | null = null;
    let panner: PannerNode | null = null;

    if (def.type === "positional") {
      const positional = def.positional ?? {};
      const envProps = positional.extensions?.KHR_audio_environment;
      if (envProps?.airAbsorption?.enabled || typeof envProps?.coneOuterCutoff === "number") {
        filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 20000;
        tail.connect(filter);
        tail = filter;
      }
      panner = context.createPanner();
      const model = envProps?.spatializationModel ?? this.listenerDef?.spatializationModel ?? "equalpower";
      panner.panningModel = model === "HRTF" ? "HRTF" : "equalpower";
      if (positional.distanceModel === "custom" && envProps?.distanceCurve) {
        panner.distanceModel = "linear";
        panner.rolloffFactor = 0;
        distanceGain = context.createGain();
      } else if (positional.distanceModel === "linear" || positional.distanceModel === "exponential") {
        panner.distanceModel = positional.distanceModel;
      } else {
        panner.distanceModel = "inverse";
      }
      panner.refDistance = positional.refDistance ?? 1;
      panner.maxDistance = positional.maxDistance && positional.maxDistance > 0 ? positional.maxDistance : 1e6;
      if (panner.rolloffFactor !== 0) {
        panner.rolloffFactor = positional.rolloffFactor ?? 1;
      }
      if (positional.shapeType === "cone") {
        panner.coneInnerAngle = (positional.coneInnerAngle ?? Math.PI * 2) * RAD_TO_DEG;
        panner.coneOuterAngle = (positional.coneOuterAngle ?? Math.PI * 2) * RAD_TO_DEG;
        panner.coneOuterGain = positional.coneOuterGain ?? 0;
      }
      if ("positionX" in panner) {
        panner.positionX.value = staticPosition[0];
        panner.positionY.value = staticPosition[1];
        panner.positionZ.value = staticPosition[2];
        panner.orientationX.value = staticForward[0];
        panner.orientationY.value = staticForward[1];
        panner.orientationZ.value = staticForward[2];
      }
      tail.connect(panner);
      tail = panner;
      if (distanceGain) {
        tail.connect(distanceGain);
        tail = distanceGain;
      }
    }

    const sendProps = def.extensions?.KHR_audio_environment ?? {};
    const directGain = context.createGain();
    directGain.gain.value = sendProps.directLevel ?? 1.0;
    tail.connect(directGain);
    directGain.connect(this.listenerBus!);

    const sendGain = context.createGain();
    sendGain.gain.value = sendProps.reverbLevel ?? (def.type === "positional" ? 1.0 : 0.0);
    tail.connect(sendGain);
    if (typeof sendProps.environment === "number" && this.environmentBuses.has(sendProps.environment)) {
      sendGain.connect(this.environmentBuses.get(sendProps.environment)!.input);
    } else {
      sendGain.connect(this.sendBus!);
    }

    const instanceSources: EmitterInstance["sources"] = [];
    for (const sourceIndex of def.sources ?? []) {
      const source = sources[sourceIndex];
      if (!source || typeof source.audio !== "number") {
        continue;
      }
      const buffer = this.buffers.get(source.audio);
      if (!buffer) {
        continue;
      }
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = source.loop ?? false;
      const basePlaybackRate = source.playbackRate ?? 1.0;
      node.playbackRate.value = basePlaybackRate;
      const gain = context.createGain();
      gain.gain.value = source.gain ?? 1.0;
      node.connect(gain);
      gain.connect(input);
      if (source.autoplay) {
        node.start();
      }
      instanceSources.push({ sourceIndex, node, gain, basePlaybackRate });
    }

    return {
      emitterIndex,
      nodeIndex,
      def,
      input,
      panner,
      filter,
      distanceGain,
      directGain,
      sendGain,
      sources: instanceSources,
      staticPosition,
      staticForward,
    };
  }

  /** Shared by applyPointer's nonstandard `/sources/{i}/playing` trigger and auditionEmitter. */
  private playOneShot(instance: EmitterInstance, sourceIndex: number): void {
    const context = this.context!;
    const def = this.doc?.extensions?.KHR_audio_emitter?.sources?.[sourceIndex];
    if (!def || typeof def.audio !== "number") {
      return;
    }
    const buffer = this.buffers.get(def.audio);
    if (!buffer) {
      return;
    }
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = def.loop ?? false;
    const basePlaybackRate = def.playbackRate ?? 1.0;
    node.playbackRate.value = basePlaybackRate;
    const gain = context.createGain();
    gain.gain.value = def.gain ?? 1.0;
    node.connect(gain);
    gain.connect(instance.input);
    node.start();
    instance.sources.push({ sourceIndex, node, gain, basePlaybackRate });
    node.onended = () => {
      const at = instance.sources.findIndex((s) => s.node === node);
      if (at >= 0) {
        instance.sources.splice(at, 1);
      }
      gain.disconnect();
    };
  }

  /** (Re)fire or stop every instance of a source — one-shot drum-pad semantics (see applyPointer's `/playing` note). */
  private triggerSource(sourceIndex: number, play: boolean): number {
    let fired = 0;
    const def = this.doc?.extensions?.KHR_audio_emitter?.sources?.[sourceIndex];
    if (!def || typeof def.audio !== "number") {
      return fired;
    }
    for (const instance of this.emitterInstances) {
      if (!(instance.def.sources ?? []).includes(sourceIndex)) {
        continue;
      }
      if (!play) {
        for (let i = instance.sources.length - 1; i >= 0; i -= 1) {
          if (instance.sources[i].sourceIndex === sourceIndex) {
            try {
              instance.sources[i].node.stop();
            } catch {
              // never started
            }
          }
        }
        continue;
      }
      this.playOneShot(instance, sourceIndex);
      fired += 1;
    }
    return fired;
  }
}
