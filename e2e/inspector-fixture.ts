// A second, dedicated e2e fixture for Inspector/export coverage
// (e2e/inspector.spec.ts, e2e/export.spec.ts) — deliberately NOT the shared
// global-setup.ts fixture other specs (import.spec.ts, shell.spec.ts,
// viewport.spec.ts) already pin exact node counts/indices against. This one
// needs richer content those specs have no reason to carry: a mesh with TWO
// primitives pointing at TWO different materials (specs/ux-inspector.md's
// UX-405 "multiple materials -> a section per primitive" and UX-408's
// per-primitive material link), a second node sharing that same mesh
// (UX-410's "also used by" note), a light node, a camera node (UX-414/417/
// 418), a node carrying `KHR_audio_emitter` (UX-406), and — richer inspector
// (UX-416) — a real, decodable `baseColorTexture` on `Mat_Red` (a tiny 2x2
// PNG embedded as a `data:` URI image, generated once via pngjs'
// `PNG.sync.write` and pasted below as a static base64 literal, mirroring
// `packages/engine-three/test/material-extras-fixture.ts`'s own same-shaped
// fixture) — this is the ONLY textured fixture anywhere in the repo
// (checked: no samples/*.glb ships one), so it doubles as this repo's
// textured+lit asset for the texture-slot thumbnail/clear/transform e2e
// coverage (the SAME fixture already carries a light — "Lamp" — and a
// camera — "Cam" — so no separate lit fixture was needed either).
import { writeContainer, type Container } from "@gltfi/gltf";
import { sineBeepWavBytes } from "./wav-fixture.js";

/** 2x2 PNG (red/green/blue/yellow), generated via pngjs. */
const CHECKER_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4AWO8Y2PzP6FHjoEpQW4BwyquRwwAPN4GFWn/tPUAAAAASUVORK5CYII=";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const INSPECTOR_FIXTURE_NAME = "inspector-fixture.glb";
/** M7 (e2e/audio.spec.ts): the "Speaker" node's emitter index, now with real audio bound via `sources: [0]`. */
export const INSPECTOR_FIXTURE_EMITTER_INDEX = 0;

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildInspectorFixtureJson(): Record<string, unknown> {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const wavBytes = sineBeepWavBytes({ frequencyHz: 660 });
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength + wavBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);
  combined.set(wavBytes, positionBytes.byteLength + indexBytes.byteLength);
  const wavByteOffset = positionBytes.byteLength + indexBytes.byteLength;

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e inspector fixture" },
    scene: 0,
    // Flat (no hierarchy) — indices 0..4 are pinned exactly by
    // inspector.spec.ts/export.spec.ts's own `scene-tree.row.N` clicks, in
    // this order:
    //   0 "Widget"  — mesh 0, TWO primitives (materials 0 and 1)
    //   1 "Widget2" — mesh 0 too (shares Widget's mesh -> UX-410's note)
    //   2 "Lamp"    — KHR_lights_punctual (UX-414/UX-417 Light section)
    //   3 "Cam"     — a camera (UX-414/UX-418 Camera section); also the
    //                 KHR_audio_environment listener binding (UX-422) —
    //                 reusing the existing camera node rather than adding a
    //                 new one keeps 0..4 stable for those pinned specs.
    //   4 "Speaker" — KHR_audio_emitter (UX-406/UX-419/UX-420)
    // Index 5, APPENDED (never renumbers 0..4): "Zone" — a
    // KHR_audio_environment reverb zone (UX-421), audio pass 3/3.
    scenes: [{ nodes: [0, 1, 2, 3, 4, 5], extensions: { KHR_audio_environment: { environment: 0, activeListener: 0 } } }],
    nodes: [
      { name: "Widget", mesh: 0 },
      { name: "Widget2", mesh: 0 },
      // Offset from the origin (where Widget/Widget2 both sit) — richer
      // inspector (UX-417) e2e coverage samples rendered pixel brightness
      // before/after an intensity edit, which a light co-located with the
      // exact surface it's lighting would make degenerate (zero-distance
      // falloff).
      { name: "Lamp", translation: [1, 2, 2], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "Cam", camera: 0, extensions: { KHR_audio_environment: { listener: 0 } } },
      { name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } },
      {
        name: "Zone",
        translation: [0, 0, 0],
        extensions: { KHR_audio_environment: { environment: 0, shape: { type: "sphere", radius: 5 }, blendDistance: 1, priority: 0 } }
      }
    ],
    cameras: [{ type: "perspective", perspective: { yfov: 0.8, znear: 0.1 } }],
    meshes: [
      {
        name: "WidgetMesh",
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1, material: 0 },
          { attributes: { POSITION: 0 }, material: 1 }
        ]
      }
    ],
    materials: [
      {
        name: "Mat_Red",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.1, 0.1, 1],
          baseColorTexture: { index: 0 },
          metallicFactor: 0.2,
          roughnessFactor: 0.6
        }
      },
      { name: "Mat_Blue", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.8, 1], metallicFactor: 0.9, roughnessFactor: 0.1 } }
    ],
    textures: [{ source: 0 }],
    images: [{ uri: CHECKER_PNG_DATA_URI }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength },
      // bufferView 2: the Speaker's audio clip (M7) — see wav-fixture.ts.
      { buffer: 0, byteOffset: wavByteOffset, byteLength: wavBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensions: {
      // The root `lights`/`emitters` registries the "Lamp"/"Speaker" nodes'
      // own `extensions.KHR_lights_punctual.light`/`KHR_audio_emitter.emitter`
      // indices point into — GLTFLoader throws while resolving a light/
      // emitter index with no corresponding root array entry (which, left
      // out, silently wedges the WHOLE RenderHost pipeline for the rest of
      // the page's life: `ThreeRenderHost.loadScene` rejects, so every
      // later `HistoryStack.push`'s synchronous `onApply` notification to
      // Viewport's `patchScene` subscriber throws too, aborting
      // `dispatchCommand`'s trailing `set(...)` before it ever runs — see
      // this fixture's git history for the debugging trail).
      // Richer inspector (UX-417): non-default color/intensity so the
      // Light section's e2e coverage edits a real starting value, not just
      // whatever this app's own display defaults happen to be.
      KHR_lights_punctual: { lights: [{ type: "point", color: [1, 1, 1], intensity: 500 }] },
      // M7: real audio (audio[]/sources[]) bound via `sources: [0]` — real
      // enough for e2e/audio.spec.ts's audition -> active-voice assertion
      // (diagnostics()), not just an inert gain/distanceModel-only stub.
      // Emitter/environment authoring (UX-419): `distanceModel` (plus the
      // rest of the positional physics fields) lives under `positional`,
      // matching what `WebAudioHost.buildEmitterChain` actually reads — NOT
      // top-level, which was this fixture's own pre-UX-419 bug (silently
      // matched the OLD, also-buggy AudioSection.tsx write path, so the bug
      // was invisible to e2e coverage until now).
      KHR_audio_emitter: {
        audio: [{ bufferView: 2, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1, loop: false }],
        emitters: [
          {
            type: "positional",
            gain: 0.8,
            sources: [0],
            positional: { shapeType: "omnidirectional", distanceModel: "inverse", refDistance: 1, maxDistance: 0, rolloffFactor: 1 }
          }
        ]
      },
      // Emitter/environment authoring, audio pass 3/3 (UX-421/UX-422): one
      // environment (a real, non-default reverb preset+mix so e2e coverage
      // edits a starting value that isn't just this app's own display
      // default) + one listener, bound to "Cam" (node 3) and "Zone" (node
      // 5) respectively above, plus pinned as the scene's own defaults
      // (`scenes[0].extensions.KHR_audio_environment`).
      KHR_audio_environment: {
        listeners: [{ name: "Player", gain: 1, spatializationModel: "HRTF" }],
        environments: [{ name: "Studio", reverb: { preset: "concertHall", mix: 0.4 } }]
      }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_audio_emitter", "KHR_audio_environment"]
  };
}

export function buildInspectorFixtureBytes(): Buffer {
  const json = buildInspectorFixtureJson();
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  const bytes = writeContainer(container) as Uint8Array;
  return Buffer.from(bytes);
}
