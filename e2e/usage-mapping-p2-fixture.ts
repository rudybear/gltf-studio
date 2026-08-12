// A dedicated fixture for Usage Mapping PHASE 2 coverage
// (e2e/usage-mapping-p2.spec.ts) — deliberately NOT e2e/usage-mapping-
// fixture.ts (Phase 1's own fixture, whose header comment already explains
// why specs pin exact node/graph-node counts against a fixture and never
// share one across unrelated test files): several Phase-1 tests assert
// exact "Used in behavior (N)" counts and exact graph-node counts against
// that file, so adding new content to IT would silently drift those
// assertions. This fixture instead exercises exactly what Phase 2 adds:
//   0 "Prop_Target" — targeted by TWO asset-entity refs Phase 1 never
//                     indexed at all (UX-1115): graph node 0 (pointer/set ->
//                     /materials/0/pbrMetallicRoughness/baseColorFactor) and
//                     graph node 1 (animation/start -> clip 0, "Spin",
//                     resolving OPEN(UX-usage-animation-encoding-tbd) against
//                     a REAL animation/start-exercising asset for the first
//                     time in this repo). Node 0 ALSO picks up its own
//                     ordinary scene-node ref via UX-1102 (animation/start's
//                     existing per-scene-node attribution, unaffected by
//                     the new asset-entity index) since "Spin"'s one channel
//                     targets it — a real test that the two indices don't
//                     double-count each other.
//   1 "Prop_Zero"   — zero graph refs of ANY kind (the UX-1109/UX-1118
//                     "Attach behavior…" live-menu target) — also carries a
//                     real KHR_audio_emitter (source 0), so "On select ->
//                     Play sound" has something real to gate on/trigger.
import { writeContainer, type Container } from "@gltfi/gltf";
import { sineBeepWavBytes } from "./wav-fixture.js";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const USAGE_P2_FIXTURE_NAME = "usage-mapping-p2-fixture.glb";
export const USAGE_P2_NODE = { TARGET: 0, ZERO: 1 } as const;
export const USAGE_P2_GRAPH_NODE = { MATERIAL_POINTER_SET: 0, ANIMATION_START: 1, ON_START: 2 } as const;
export const USAGE_P2_MATERIAL_INDEX = 0;
export const USAGE_P2_ANIMATION_INDEX = 0;

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildUsageMappingP2FixtureJson(): Record<string, unknown> {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const wavBytes = sineBeepWavBytes({ frequencyHz: 550 });
  const times = new Float32Array([0, 1]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]); // identity at both keyframes — structurally real, visually inert

  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const timesBytes = new Uint8Array(times.buffer);
  const rotationBytes = new Uint8Array(rotations.buffer);

  const wavOffset = positionBytes.byteLength + indexBytes.byteLength;
  const timesOffset = wavOffset + wavBytes.byteLength;
  const rotationsOffset = timesOffset + timesBytes.byteLength;
  const combined = new Uint8Array(rotationsOffset + rotationBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);
  combined.set(wavBytes, wavOffset);
  combined.set(timesBytes, timesOffset);
  combined.set(rotationBytes, rotationsOffset);

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e usage-mapping-p2 fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Prop_Target", mesh: 0, translation: [-2, 0, 0] },
      { name: "Prop_Zero", mesh: 0, translation: [2, 0, 0], extensions: { KHR_audio_emitter: { emitter: 0 } } }
    ],
    meshes: [{ name: "TriMesh", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "Mat_Green", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.8, 0.3, 1] } }],
    animations: [
      {
        name: "Spin",
        channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
        samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }]
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 3, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 4, componentType: 5126, count: 2, type: "VEC4" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength },
      { buffer: 0, byteOffset: wavOffset, byteLength: wavBytes.byteLength },
      { buffer: 0, byteOffset: timesOffset, byteLength: timesBytes.byteLength },
      { buffer: 0, byteOffset: rotationsOffset, byteLength: rotationBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }],
    extensionsUsed: ["KHR_interactivity", "KHR_audio_emitter"],
    extensions: {
      KHR_audio_emitter: {
        audio: [{ bufferView: 2, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1, loop: false, autoplay: false }],
        emitters: [{ type: "positional", gain: 1, sources: [0] }]
      },
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "float4" }, { signature: "ref" }],
            declarations: [{ op: "pointer/set" }, { op: "animation/start" }, { op: "event/onStart" }],
            variables: [],
            events: [],
            nodes: [
              {
                // UX-1115: a /materials/{M} pointer — never attributed to any
                // scene node (UX-1105's own family scope), only to material 0
                // via buildAssetUsageIndex. Wired reachable from the
                // event/onStart node below (node 2) so `@gltfi/ir`'s
                // `importGraph` actually EMITS this statement — needed for
                // the Script tab's Monaco pointer-link (UX-1119) to have a
                // real quoted path to click in the first place.
                declaration: 0,
                configuration: { pointer: { value: ["/materials/0/pbrMetallicRoughness/baseColorFactor"] }, type: { value: [0] } },
                values: { value: { type: 0, value: [0.2, 0.8, 0.3, 1] } },
                flows: {},
                extras: { gltfi: { x: 320, y: 20 } }
              },
              {
                // UX-1102 (scene-node fan-out, unchanged) + UX-1115 (this
                // asset's own animation-entity attribution) both derive from
                // this ONE node. Deliberately left UNREACHABLE from any
                // handler — OPEN(UX-usage-script-jump-animation-gap) already
                // documents animation/* reachability as an untested gap;
                // this fixture doesn't paper over that, only exercises the
                // asset-index/badge side of this op family.
                declaration: 1,
                values: { animation: { type: 1, value: [0] } },
                flows: {},
                extras: { gltfi: { x: 320, y: 160 } }
              },
              {
                declaration: 2,
                flows: { out: { node: 0, socket: "in" } },
                extras: { gltfi: { x: 20, y: 20 } }
              }
            ]
          }
        ]
      }
    }
  };
}

export function buildUsageMappingP2FixtureBytes(): Buffer {
  const json = buildUsageMappingP2FixtureJson();
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
