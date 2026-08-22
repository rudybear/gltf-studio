// A dedicated e2e fixture (mirroring e2e/audio-graph-invalid-fixture.ts's
// pattern) carrying a pre-r2, LEGACY `oscillator` NODE kind — a shape this
// app's own audio-graph canvas/palette can no longer author at all
// (`audio-node-registry.ts` derives straight from `@gltf-audiograph/kernel`'s
// r2 registry, which has no `oscillator` node kind), but that a foreign
// asset (exported by an older tool, or hand-edited) could still carry. Used
// by e2e/audio-script.spec.ts's malformed/legacy-document coverage
// (specs/ux-audio-script.md UX-1409): the Audio Script tab's honest
// diagnostics-only placeholder is error-handling for exactly this kind of
// document, not a "legacy support" affordance — nothing this app's palette
// can produce reaches it any more.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const AUDIO_GRAPH_LEGACY_OSCILLATOR_FIXTURE_NAME = "audio-graph-legacy-oscillator-fixture.glb";
export const AUDIO_GRAPH_LEGACY_OSCILLATOR_NODE_LABEL = "legacyOsc";

function buildAudioGraphLegacyOscillatorFixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e audio-graph-legacy-oscillator fixture" },
    scene: 0,
    scenes: [{ nodes: [0], extensions: { KHR_audio_emitter: { emitters: [0] } } }],
    nodes: [{ name: "Root" }],
    extensions: {
      KHR_audio_emitter: {
        audio: [],
        sources: [],
        emitters: [{ type: "global", gain: 1 }]
      },
      KHR_audio_graph: {
        graphs: [
          {
            // Pre-r2 shape: `oscillator` as a graph.nodes[] KIND (r2 moved this
            // to KHR_audio_emitter source data — see this file's header). Wired
            // straight to the emitter so the graph is otherwise well-formed —
            // the ONLY violation is the illegal node kind itself.
            nodes: [{ kind: "oscillator", label: AUDIO_GRAPH_LEGACY_OSCILLATOR_NODE_LABEL, params: { type: "sine", frequency: 440 } }],
            connections: [],
            outputs: [{ node: 0, emitter: 0 }]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_audio_emitter", "KHR_audio_graph"]
  };
}

export function buildAudioGraphLegacyOscillatorFixtureBytes(): Buffer {
  const json = buildAudioGraphLegacyOscillatorFixtureJson();
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return Buffer.from(writeContainer(container) as Uint8Array);
}
