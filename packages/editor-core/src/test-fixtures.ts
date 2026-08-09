// Synthetic-container test fixtures shared by this package's own tests. Not
// exported from index.ts (test-only helper) and not itself a `*.test.ts`
// file, so vitest's `include` pattern never picks it up as a suite.
//
// Builds a small glTF JSON with a real KHR_interactivity graph + a couple of
// nodes/materials/an audio emitter, round-trips it through
// `@gltfi/gltf`'s real `writeContainer`/`parseContainer` (rather than just
// wrapping a JSON string) so tests exercise the exact same container
// machinery `save.ts` uses in production — never copying any Khronos
// conformance-corpus asset into this repo.
import { parseContainer, writeContainer, type Container } from "@gltfi/gltf";
import { createDocument, type EditorDocument } from "./document.js";

const CHUNK_TYPE_JSON = 0x4e4f534a;

export function fixtureGltfJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Alpha", translation: [0, 0, 0] },
      { name: "Beta", translation: [1, 0, 0] }
    ],
    materials: [{ name: "Mat0", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    extensionsUsed: ["KHR_interactivity", "KHR_audio_emitter"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "float" }, { signature: "bool" }],
            declarations: [{ op: "event/onStart" }, { op: "event/onTick" }, { op: "math/add" }],
            variables: [{ id: "v0", type: 0, value: [0] }],
            events: [],
            nodes: [
              { declaration: 0, flows: {} },
              { declaration: 1, flows: {}, values: {} }
            ]
          }
        ]
      },
      KHR_audio_emitter: {
        emitters: [{ type: "positional", gain: 1 }]
      }
    }
  };
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

/** A fresh `EditorDocument` over the default fixture JSON (glb-kind container). */
export function fixtureDocument(json: unknown = fixtureGltfJson()): EditorDocument {
  return createDocument(containerFromJson(json));
}
