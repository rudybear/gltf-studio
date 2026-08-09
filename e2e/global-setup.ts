// Generates the e2e fixture .glb once per Playwright run — a tiny synthetic
// 4-node scene, built in-process via vendored @gltfi/gltf's real
// `writeContainer` (never a corpus asset copied into this repo, per this
// program's "no corpus copying" rule). Node 0 (root, a group) has children
// 1 (a mesh node) and 2 (a light node); node 1 has child 3 (a nested mesh
// node) — enough hierarchy depth to exercise the scene tree's indent/twisty
// behavior (UX-200/UX-201). `WidgetMesh` carries real POSITION/NORMAL
// accessors (a flat triangle spanning roughly [-1,1]x[-1,1] at z=0, embedded
// as a base64 `data:` URI buffer — same fixture shape/pattern as
// packages/contract-tests/src/render-host.ts's portable fixture) so the M2
// viewport (real engine-three RenderHost, no longer a placeholder) actually
// renders and can pick it; `Widget_Detail` (node 3) reuses the same mesh but
// is translated well outside the fixed front-camera pose e2e/viewport.spec.ts
// uses, so a center-of-canvas click deterministically hits `Widget` (node 1)
// alone.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const FIXTURE_GLB_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "simple-scene.glb");

/** Front-on camera pose (see e2e/viewport.spec.ts): node 1 ("Widget") dead center, node 3 ("Widget_Detail") nowhere in frame. */
export const FIXTURE_FRONT_CAMERA_POSE = { position: [0, 0, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };

function base64FromBytes(bytes: Uint8Array): string {
  // global-setup.ts runs under Node (Playwright's test runner), not a
  // browser — Buffer is the natural base64 encoder here, unlike the
  // browser-side `btoa` packages/contract-tests/src/render-host.ts's
  // otherwise-identical fixture builder uses.
  return Buffer.from(bytes).toString("base64");
}

function buildFixtureJson(): Record<string, unknown> {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  // "Idle" animation keyframes: 2 keyframes, node 1's rotation from identity
  // to a small twist. Real accessors are required here too — an
  // animation channel/sampler with no backing data isn't just incomplete
  // JSON the way the pre-M2 fixture's `{channels:[...], samplers:[]}` was
  // (fine when the app only ever read this as inert JSON); GLTFLoader (the
  // real parser the M2 viewport now routes through) throws while resolving
  // the channel's sampler otherwise.
  const times = new Float32Array([0, 1]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 0.7071068, 0.7071068]);
  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const timeBytes = new Uint8Array(times.buffer);
  const rotationBytes = new Uint8Array(rotations.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + normalBytes.byteLength + timeBytes.byteLength + rotationBytes.byteLength);
  let offset = 0;
  for (const chunk of [positionBytes, normalBytes, timeBytes, rotationBytes]) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Root", children: [1, 2] },
      { name: "Widget", mesh: 0, children: [3] },
      { name: "KeyLight", extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "Widget_Detail", mesh: 0, translation: [10, 10, 10] }
    ],
    meshes: [{ name: "WidgetMesh", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [
      { name: "WidgetMaterial", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1] } }
    ],
    animations: [
      {
        name: "Idle",
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
        samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }]
      }
    ],
    extensions: {
      KHR_lights_punctual: { lights: [{ type: "point" }] },
      // A small, real KHR_interactivity graph (specs/ux-graph-canvas.md) for
      // e2e/graph-canvas.spec.ts: node 0 is an event/onStart handler (flow
      // unconnected — nothing to run, this fixture only exercises the
      // EDITOR, not the runtime); node 1 is a math/add with two float
      // literals, also unconnected, giving the canvas real nodes/ports/
      // literals to render and edit without needing a corpus asset. The
      // `counter` variable exists for e2e/script.spec.ts's (specs/ux-script.md
      // UX-7xx) Script tab coverage — it gives a hand-typed `V.counter = ...`
      // edit something real to reference; it adds no `nodes[]` entry (a
      // graph-level `variables[]` array is a sibling of `nodes[]`, not
      // itself one), so it changes nothing graph-canvas.spec.ts asserts
      // (node count/indices/declarations) above.
      KHR_interactivity: {
        graphs: [
          {
            types: [{ signature: "float" }],
            declarations: [{ op: "event/onStart" }, { op: "math/add" }],
            variables: [{ id: "counter", type: 0, value: [0] }],
            nodes: [
              { declaration: 0 },
              { declaration: 1, values: { a: { type: 0, value: [1] }, b: { type: 0, value: [2] } } }
            ]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_interactivity"],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC4" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: normalBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength + normalBytes.byteLength, byteLength: timeBytes.byteLength },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength + normalBytes.byteLength + timeBytes.byteLength,
        byteLength: rotationBytes.byteLength
      }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }]
  };
}

export default function globalSetup(): void {
  const json = buildFixtureJson();
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  const bytes = writeContainer(container) as Uint8Array;

  mkdirSync(dirname(FIXTURE_GLB_PATH), { recursive: true });
  writeFileSync(FIXTURE_GLB_PATH, bytes);
}
