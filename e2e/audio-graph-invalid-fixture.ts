// A second, dedicated e2e fixture (mirroring e2e/inspector-fixture.ts's
// pattern) carrying a DELIBERATELY invalid KHR_audio_graph — a cycle
// between two processing nodes — for e2e/audio.spec.ts's lint-banner
// coverage (specs/ux-audio-graph.md UX-602/UX-603). Kept separate from the
// shared global-setup.ts fixture so its intentionally-broken graph can't
// affect any other spec.
import { writeContainer, type Container } from "@gltfi/gltf";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export const AUDIO_GRAPH_INVALID_FIXTURE_NAME = "audio-graph-invalid-fixture.glb";
export const AUDIO_GRAPH_CYCLE_NODE_LABELS = ["gainA", "filterB"] as const;

function buildAudioGraphInvalidFixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "gltf-studio e2e audio-graph-invalid fixture" },
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
            // gainA -> filterB -> gainA: a two-node cycle (no inputs/outputs
            // bindings at all — the graph is invalid regardless, but the
            // cycle is the specific violation e2e/audio.spec.ts asserts the
            // banner names).
            nodes: [
              { kind: "gain", label: AUDIO_GRAPH_CYCLE_NODE_LABELS[0], params: { gain: 0.5 } },
              { kind: "biquadFilter", label: AUDIO_GRAPH_CYCLE_NODE_LABELS[1], params: { type: "lowpass", frequency: 800 } }
            ],
            connections: [
              { from: { node: 0 }, to: { node: 1 } },
              { from: { node: 1 }, to: { node: 0 } }
            ]
          }
        ]
      }
    },
    extensionsUsed: ["KHR_audio_emitter", "KHR_audio_graph"]
  };
}

export function buildAudioGraphInvalidFixtureBytes(): Buffer {
  const json = buildAudioGraphInvalidFixtureJson();
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
