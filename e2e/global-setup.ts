// Generates the e2e fixture .glb(s) once per Playwright run — tiny synthetic
// 4-node scenes, built in-process via vendored @gltfi/gltf's real
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
//
// Two fixtures share this same base scene (`buildBaseSceneJson`), differing
// only in their embedded `KHR_interactivity` graph: `simple-scene.glb`
// (FIXTURE_GLB_PATH) carries an inert graph for editor-only coverage
// (e2e/graph-canvas.spec.ts, e2e/script.spec.ts) — several of those specs
// hardcode its exact node count/indices, so that graph must never change.
// `play-scene.glb` (FIXTURE_PLAY_GLB_PATH) carries a second, independent,
// actually-runnable graph (PLAY_GRAPH below) for the Play Mode e2e suite
// (e2e/play.spec.ts), which needs a ticking counter and a click-triggered
// pointer/set to observe the interpreter actually running.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContainer, type Container } from "@gltfi/gltf";
import { sineBeepWavBytes } from "./wav-fixture.js";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const FIXTURE_GLB_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "simple-scene.glb");
export const FIXTURE_PLAY_GLB_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "play-scene.glb");
/** specs/ux-script.md UX-714's no-graph empty state: a minimal, real, valid glTF with no `KHR_interactivity` extension at all (not even an empty `graphs: []`) — the "never added a graph" case, distinct from a graph existing at some other index. */
export const FIXTURE_NO_GRAPH_GLB_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "no-graph-scene.glb");

/** Front-on camera pose (see e2e/viewport.spec.ts): node 1 ("Widget") dead center, node 3 ("Widget_Detail") nowhere in frame. */
export const FIXTURE_FRONT_CAMERA_POSE = { position: [0, 0, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as [number, number, number] };

/** M7 (specs/engine-api.md AH-001/AH-002, e2e/audio.spec.ts): the scene-level global emitter's index into `extensions.KHR_audio_emitter.emitters`. */
export const FIXTURE_AUDIO_EMITTER_INDEX = 0;
/** M7: the `extensions.KHR_audio_graph.graphs[0]` bufferSource -> gain -> emitter chain's one processing node's label. */
export const FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL = "beepGain";

function base64FromBytes(bytes: Uint8Array): string {
  // global-setup.ts runs under Node (Playwright's test runner), not a
  // browser — Buffer is the natural base64 encoder here, unlike the
  // browser-side `btoa` packages/contract-tests/src/render-host.ts's
  // otherwise-identical fixture builder uses.
  return Buffer.from(bytes).toString("base64");
}

// sineBeepWavBytes (KHR_audio_emitter's `audio[]` WAV data, M7) lives in
// ./wav-fixture.ts, shared with inspector-fixture.ts.

// A small, real KHR_interactivity graph (specs/ux-graph-canvas.md) for
// e2e/graph-canvas.spec.ts: node 0 is an event/onStart handler (flow
// unconnected — nothing to run, this fixture only exercises the EDITOR, not
// the runtime); node 1 is a math/add with two float literals, also
// unconnected, giving the canvas real nodes/ports/literals to render and
// edit without needing a corpus asset. The `counter` variable exists for
// e2e/script.spec.ts's (specs/ux-script.md UX-7xx) Script tab coverage — it
// gives a hand-typed `V.counter = ...` edit something real to reference; it
// adds no `nodes[]` entry (a graph-level `variables[]` array is a sibling of
// `nodes[]`, not itself one), so it changes nothing graph-canvas.spec.ts
// asserts (node count/indices/declarations) above. DO NOT edit this graph —
// see the file-level doc comment.
const EXISTING_GRAPH = {
  types: [{ signature: "float" }],
  declarations: [{ op: "event/onStart" }, { op: "math/add" }],
  variables: [{ id: "counter", type: 0, value: [0] }],
  nodes: [
    { declaration: 0 },
    { declaration: 1, values: { a: { type: 0, value: [1] }, b: { type: 0, value: [2] } } }
  ]
};

// A real, runnable KHR_interactivity graph for the Play Mode e2e suite
// (e2e/play.spec.ts): variable `counter` (float, initial 0) increments by 1
// on every event/onTick; clicking node 1 ("Widget") fires event/onSelect
// (scoped via `nodeIndex` config), which sets `counter` to 100 and then
// moves Widget's translation to [0.5, 0, 0] via pointer/set — enough
// observable, distinct behavior for the suite to assert both the tick loop
// and click-triggered handlers actually ran through the real interpreter.
const PLAY_GRAPH = {
  types: [{ signature: "float" }, { signature: "float3" }],
  variables: [{ id: "counter", type: 0, value: [0] }],
  declarations: [
    { op: "event/onTick" }, // 0
    { op: "variable/get" }, // 1
    { op: "math/add" }, // 2
    { op: "variable/set" }, // 3
    { op: "event/onSelect" }, // 4
    { op: "pointer/set" } // 5
  ],
  nodes: [
    // 0: onTick -> fires node 3 (variable/set) once node 1/2's pure read+add are resolved on demand
    { declaration: 0, flows: { out: { node: 3, socket: "in" } } },
    // 1: variable/get(counter) -- pure, no flow needed
    { declaration: 1, configuration: { variable: { value: [0] } } },
    // 2: math/add(node1.value, 1) -- pure, no flow needed
    { declaration: 2, values: { a: { node: 1, socket: "value" }, b: { type: 0, value: [1] } } },
    // 3: variable/set(counter <- node2.value), triggered by onTick
    { declaration: 3, configuration: { variables: { value: [0] } }, values: { "0": { node: 2, socket: "value" } } },
    // 4: onSelect(nodeIndex: 1 i.e. "Widget") -> fires node 5
    {
      declaration: 4,
      configuration: { nodeIndex: { value: [1] }, stopPropagation: { value: [false] } },
      flows: { out: { node: 5, socket: "in" } }
    },
    // 5: variable/set(counter <- literal 100), triggered by onSelect -> fires node 6
    {
      declaration: 3,
      configuration: { variables: { value: [0] } },
      values: { "0": { type: 0, value: [100] } },
      flows: { out: { node: 6, socket: "in" } }
    },
    // 6: pointer/set(/nodes/1/translation <- [0.5, 0, 0] as float3), triggered by node 5
    {
      declaration: 5,
      configuration: { pointer: { value: ["/nodes/1/translation"] }, type: { value: [1] } },
      values: { value: { type: 1, value: [0.5, 0, 0] } }
    }
  ]
};

function buildBaseSceneJson(interactivityGraph: unknown): Record<string, unknown> {
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
  const wavBytes = sineBeepWavBytes();
  const combined = new Uint8Array(
    positionBytes.byteLength + normalBytes.byteLength + timeBytes.byteLength + rotationBytes.byteLength + wavBytes.byteLength
  );
  let offset = 0;
  for (const chunk of [positionBytes, normalBytes, timeBytes, rotationBytes, wavBytes]) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const wavByteOffset = positionBytes.byteLength + normalBytes.byteLength + timeBytes.byteLength + rotationBytes.byteLength;

  return {
    asset: { version: "2.0", generator: "gltf-studio e2e fixture" },
    scene: 0,
    // M7: a SCENE-level global emitter binding (not on any `nodes[]` entry)
    // — deliberately additive-only, so it can't perturb any other e2e
    // spec's node-indexed assertions (identity-strip chip counts,
    // scene-tree row counts, etc.) that already pin this fixture's node
    // list exactly.
    scenes: [{ nodes: [0], extensions: { KHR_audio_emitter: { emitters: [FIXTURE_AUDIO_EMITTER_INDEX] } } }],
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
      // Full punctual-light control (specs/ux-viewport.md UX-313): a real
      // document light now turns the neutral studio rig OFF automatically
      // (AUTO policy — authored lighting becomes the visible truth), so
      // KeyLight — previously a bare `{type:"point"}` with three.js's own
      // default intensity of 1, which rendered adequately ONLY because the
      // (now-disabled-for-this-fixture) studio rig was doing the real
      // illumination work — needs a real, non-trivial intensity of its own
      // so every pixel-based e2e test against this shared fixture (most
      // notably e2e/viewport-real-click.spec.ts's DEFAULT-camera, no-fixed-
      // pose "find the rendered object by scanning pixels" tests) still
      // finds Widget clearly lit. KeyLight's own POSITION stays at the
      // origin, unchanged (`e2e/scene-tree-reparent-world-position.spec.ts`
      // asserts it starts there) — intensity is the only lever available.
      KHR_lights_punctual: { lights: [{ type: "point", intensity: 200 }] },
      KHR_interactivity: { graphs: [interactivityGraph] },
      // M7: a real KHR_audio_emitter (sineBeepWavBytes' bufferView-embedded
      // WAV, resolved by @gltf-studio/audio-webaudio's WebAudioHost) plus a
      // KHR_audio_graph bufferSource -> gain -> emitter chain for
      // e2e/audio.spec.ts's audio-graph-tab coverage — a global (not
      // positional) emitter/graph so it needs no node binding at all.
      KHR_audio_emitter: {
        audio: [{ bufferView: 4, mimeType: "audio/wav" }],
        sources: [{ audio: 0, gain: 1, loop: false }],
        emitters: [{ type: "global", gain: 1, sources: [0] }]
      },
      KHR_audio_graph: {
        graphs: [
          {
            nodes: [{ kind: "gain", label: FIXTURE_AUDIO_GRAPH_GAIN_NODE_LABEL, params: { gain: 0.6 } }],
            connections: [],
            inputs: [{ source: 0, node: 0 }],
            outputs: [{ node: 0, emitter: FIXTURE_AUDIO_EMITTER_INDEX }]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_lights_punctual", "KHR_interactivity", "KHR_audio_emitter", "KHR_audio_graph"],
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
      },
      // bufferView 4: the sine-beep WAV — no `accessors[]` entry references
      // it (glTF only requires an accessor for vertex/animation data;
      // KHR_audio_emitter's `audio[].bufferView` points at a bufferView
      // directly, per spec).
      { buffer: 0, byteOffset: wavByteOffset, byteLength: wavBytes.byteLength }
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64FromBytes(combined)}`, byteLength: combined.byteLength }]
  };
}

function buildFixtureJson(): Record<string, unknown> {
  return buildBaseSceneJson(EXISTING_GRAPH);
}

/** specs/ux-script.md UX-714: a minimal, real, valid single-node glTF with no `KHR_interactivity` extension — deliberately NOT `buildBaseSceneJson` (that function always writes a `KHR_interactivity` extension, since every other e2e suite needs one present); this is the one fixture that must NOT have one. */
function buildNoGraphFixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e fixture (no-graph)" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Empty" }]
  };
}

function writeGlb(json: Record<string, unknown>, path: string): void {
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  const bytes = writeContainer(container) as Uint8Array;
  writeFileSync(path, bytes);
}

export default function globalSetup(): void {
  mkdirSync(dirname(FIXTURE_GLB_PATH), { recursive: true });
  writeGlb(buildFixtureJson(), FIXTURE_GLB_PATH);
  writeGlb(buildBaseSceneJson(PLAY_GRAPH), FIXTURE_PLAY_GLB_PATH);
  writeGlb(buildNoGraphFixtureJson(), FIXTURE_NO_GRAPH_GLB_PATH);
}
