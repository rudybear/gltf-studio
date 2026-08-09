// A second, dedicated e2e fixture for Inspector/export coverage
// (e2e/inspector.spec.ts, e2e/export.spec.ts) — deliberately NOT the shared
// global-setup.ts fixture other specs (import.spec.ts, shell.spec.ts,
// viewport.spec.ts) already pin exact node counts/indices against. This one
// needs richer content those specs have no reason to carry: a mesh with TWO
// primitives pointing at TWO different materials (specs/ux-inspector.md's
// UX-405 "multiple materials -> a section per primitive" and UX-408's
// per-primitive material link), a second node sharing that same mesh
// (UX-410's "also used by" note), a light node, a camera node (UX-414), and
// a node carrying `KHR_audio_emitter` (UX-406).
//
// Built in-process via the real `@gltfi/gltf` `writeContainer` (same
// approach as global-setup.ts — never a corpus asset copied into the repo)
// and handed to Playwright as an in-memory buffer via `setInputFiles`'s
// `{ name, mimeType, buffer }` form, so no second file needs to live under
// e2e/fixtures/.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const INSPECTOR_FIXTURE_NAME = "inspector-fixture.glb";

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildInspectorFixtureJson(): Record<string, unknown> {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e inspector fixture" },
    scene: 0,
    // Flat (no hierarchy) — five top-level nodes, indices 0..4, in this order:
    //   0 "Widget"  — mesh 0, TWO primitives (materials 0 and 1)
    //   1 "Widget2" — mesh 0 too (shares Widget's mesh -> UX-410's note)
    //   2 "Lamp"    — KHR_lights_punctual (UX-414 light note)
    //   3 "Cam"     — a camera (UX-414 camera note)
    //   4 "Speaker" — KHR_audio_emitter (UX-406)
    scenes: [{ nodes: [0, 1, 2, 3, 4] }],
    nodes: [
      { name: "Widget", mesh: 0 },
      { name: "Widget2", mesh: 0 },
      { name: "Lamp", extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: "Cam", camera: 0 },
      { name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } }
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
      { name: "Mat_Red", pbrMetallicRoughness: { baseColorFactor: [0.8, 0.1, 0.1, 1], metallicFactor: 0.2, roughnessFactor: 0.6 } },
      { name: "Mat_Blue", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.8, 1], metallicFactor: 0.9, roughnessFactor: 0.1 } }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength }
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
      KHR_lights_punctual: { lights: [{ type: "point" }] },
      KHR_audio_emitter: { emitters: [{ type: "positional", gain: 0.8, distanceModel: "inverse" }] }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_audio_emitter"]
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
