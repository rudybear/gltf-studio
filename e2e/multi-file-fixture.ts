// e2e coverage for the multi-file `.gltf` import fix (specs/ux-shell.md
// UX-115/UX-116, `packages/app/src/lib/pack-gltf.ts`): a small, synthetic
// `.gltf` + external `.bin` + external `.wav`, structurally the same shape
// as the real user-reported drum-kit asset this fix was verified against
// (a `buffers[].uri` pointing at a sibling `.bin`, a `KHR_audio_emitter`
// `audio[].uri` pointing at a sibling `.wav`) — built in-process, never a
// corpus asset copied into the repo, and handed to Playwright's
// `setInputFiles` as in-memory `{ name, mimeType, buffer }` payloads (no
// real files under e2e/fixtures/ needed at all, since a multi-select
// `<input>` accepts an array of those payloads directly).
import { sineBeepWavBytes } from "./wav-fixture.js";

export const MULTI_FILE_GLTF_NAME = "multi-file-scene.gltf";
export const MULTI_FILE_BIN_NAME = "multi-file-scene.bin";
export const MULTI_FILE_WAV_NAME = "multi-file-scene.wav";

/**
 * Node 0 ("Widget") is a flat triangle spanning roughly [-1,1]x[-1,1] at
 * z=0 — same fixture shape/pattern as global-setup.ts's WidgetMesh, so the
 * SAME `FIXTURE_FRONT_CAMERA_POSE` frames it dead center for a pixel/pick
 * assert. Node 1 ("Speaker") carries the external-audio-backed
 * `KHR_audio_emitter`, singular `emitter` index — the shape
 * `packages/app/src/components/inspector/AudioSection.tsx`'s Audition
 * control reads (same convention e2e/inspector-fixture.ts's own "Speaker"
 * node uses); the real drum-kit asset this fix targets instead uses the
 * array form (`emitters: [n]`, also supported by
 * `@gltf-studio/audio-webaudio`'s `WebAudioHost` per its `GltfNodeAudio`
 * type) — `pack-gltf.ts` itself never reads/rewrites node-level emitter
 * refs at all, so this fixture's choice of shape has no bearing on what
 * this suite is actually regression-testing (external-URI resolution).
 */
function buildMultiFileGltfJson(): Record<string, unknown> {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e multi-file fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Widget", mesh: 0 },
      { name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } }
    ],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength }
    ],
    buffers: [{ uri: MULTI_FILE_BIN_NAME, byteLength: positions.byteLength + normals.byteLength }],
    extensionsUsed: ["KHR_audio_emitter"],
    extensions: {
      // Root registries `nodes[1]`'s extension indexes into (same
      // "must exist or GLTFLoader/loadEmitters throw" reasoning as
      // inspector-fixture.ts's own header comment).
      KHR_audio_emitter: {
        audio: [{ uri: MULTI_FILE_WAV_NAME, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1 }],
        emitters: [{ name: "SpeakerEmitter", type: "positional", gain: 1, sources: [0] }]
      }
    }
  };
}

function multiFileBinBytes(): Uint8Array {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const combined = new Uint8Array(positions.byteLength + normals.byteLength);
  combined.set(new Uint8Array(positions.buffer), 0);
  combined.set(new Uint8Array(normals.buffer), positions.byteLength);
  return combined;
}

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

function gltfPayload(): FilePayload {
  return { name: MULTI_FILE_GLTF_NAME, mimeType: "model/gltf+json", buffer: Buffer.from(JSON.stringify(buildMultiFileGltfJson())) };
}

function binPayload(): FilePayload {
  return { name: MULTI_FILE_BIN_NAME, mimeType: "application/octet-stream", buffer: Buffer.from(multiFileBinBytes()) };
}

function wavPayload(): FilePayload {
  return { name: MULTI_FILE_WAV_NAME, mimeType: "audio/wav", buffer: Buffer.from(sineBeepWavBytes({ frequencyHz: 550 })) };
}

/** The `.gltf` together with both siblings it references — the success path (UX-115). */
export function multiFileFixtureComplete(): FilePayload[] {
  return [gltfPayload(), binPayload(), wavPayload()];
}

/** Just the `.gltf` alone — every external reference unresolved, the failure path (UX-116). */
export function multiFileFixtureGltfOnly(): FilePayload[] {
  return [gltfPayload()];
}
