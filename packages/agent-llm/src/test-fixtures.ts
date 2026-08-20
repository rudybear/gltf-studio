// Synthetic-container test fixtures for this package's own tests. Mirrors
// packages/agent-mock/src/test-fixtures.ts's pattern exactly (round-trips
// through @gltfi/gltf's real parseContainer/writeContainer rather than just
// wrapping a JSON string) — agent-mock's fixtureDocument/fixtureSceneJson
// are test-only there too and not exported from its public index.ts, so
// duplicated here rather than reached into across a package boundary.
import { parseContainer, writeContainer, type Container } from "@gltfi/gltf";
import { createDocument, type EditorDocument } from "@gltf-studio/editor-core";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export interface FixtureOptions {
  /** Pre-populates extensions.KHR_interactivity.graphs[0] with one event/onStart node. */
  withGraph?: boolean;
  /** Gives node 0 a KHR_audio_emitter emitter with one non-empty source. */
  withAudio?: boolean;
}

export function fixtureSceneJson(opts: FixtureOptions = {}): Record<string, unknown> {
  const { withGraph = false, withAudio = false } = opts;

  const nodes: Array<Record<string, unknown>> = [
    { name: "Alpha", translation: [0, 0, 0] },
    { name: "Beta", translation: [2, 0, 0] }
  ];

  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes,
    materials: [{ name: "Mat0", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }]
  };

  const extensionsUsed: string[] = [];
  const extensions: Record<string, unknown> = {};

  if (withGraph) {
    extensionsUsed.push("KHR_interactivity");
    extensions.KHR_interactivity = {
      graph: 0,
      graphs: [
        {
          types: [{ signature: "float" }],
          declarations: [{ op: "event/onStart" }],
          variables: [],
          events: [],
          nodes: [{ declaration: 0, flows: {} }]
        }
      ]
    };
  }

  if (withAudio) {
    extensionsUsed.push("KHR_audio_emitter");
    extensions.KHR_audio_emitter = {
      audio: [{ uri: "data:audio/wav;base64,AAAA" }],
      sources: [{ audio: 0, gain: 1, autoplay: false, loop: false }],
      emitters: [{ type: "positional", gain: 1, sources: [0] }]
    };
    nodes[0].extensions = { KHR_audio_emitter: { emitter: 0 } };
  }

  if (extensionsUsed.length > 0) json.extensionsUsed = extensionsUsed;
  if (Object.keys(extensions).length > 0) json.extensions = extensions;
  return json;
}

/** Builds a `Container` from a plain JSON object by round-tripping it through the real `writeContainer`/`parseContainer` pair (glb kind). */
export function containerFromJson(json: unknown): Container {
  const jsonText = JSON.stringify(json);
  const draft: Container = {
    kind: "glb",
    chunks: [{ type: CHUNK_TYPE_JSON, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json,
    binaryChunk: undefined
  };
  const bytes = writeContainer(draft);
  return parseContainer(bytes);
}

export function fixtureDocument(opts?: FixtureOptions): EditorDocument {
  return createDocument(containerFromJson(fixtureSceneJson(opts)));
}
