// Resolves a `MappedNode` (as `map-audio-graph.ts` produces it) back to
// which of the three KHR_audio_graph entities it represents — a real
// `graph.nodes[]` entry, a synthetic `audio-buffer-source` node (projected
// from `graph.inputs[]`, one per bound `KHR_audio_emitter` source), or a
// synthetic terminal `emitter` node (projected from `graph.outputs[]`,
// UX-607). Editing needs this because `AudioGraphEdit`'s command factories
// (`connectAudio`/`disconnectAudio`/`removeNode`/`setNodeParam`/
// `setNodePosition`) operate on that real identity (a `graph.nodes[]`
// index, or a `KHR_audio_emitter` source/emitter index), not on the
// canvas's own `MappedNode.index` (a dense 0..N-1 over ALL three kinds
// combined, per `map-audio-graph.ts`'s `order` array).
//
// Deliberately duck-types `MappedNode.raw` rather than requiring
// `map-audio-graph.ts` to grow a new discriminant field: `raw` already
// carries exactly this information today (the literal `KHRGraphNodeSpec`
// for a real node — identifiable by its `kind` string property — or a bare
// `{ source: number }`/`{ emitter: number }` for the two synthetic kinds),
// and preserving `raw`'s existing shape for real nodes matters beyond this
// file too: `graph-view.tsx`'s `nodePosition()` reads `node.raw.extras
// ?.gltfi` directly (DOC-027's convention) to place a node at its authored
// canvas position, so a real audio node's `raw` must keep being the literal
// `KHRGraphNodeSpec` (extras and all) for `AudioGraphEdit.setNodePosition`
// writes to round-trip into the rendered position for free.
import type { MappedGraph, MappedNode } from "@gltf-studio/graph-canvas";

export type AudioEntity =
  | { type: "node"; rawIndex: number }
  | { type: "source"; sourceIndex: number }
  | { type: "emitter"; emitterIndex: number };

export function identifyMappedNode(node: MappedNode): AudioEntity {
  const raw = node.raw as { kind?: unknown; source?: unknown; emitter?: unknown };
  if (typeof raw?.kind === "string") {
    // map-audio-graph.ts's `order` construction always creates every
    // "node:i" entry during its FIRST pass (graph.nodes.forEach, in index
    // order, before any "source:N"/"emitter:N" entries are appended), so a
    // real node's dense output-array position is always identical to its
    // raw `graph.nodes[]` index.
    return { type: "node", rawIndex: node.index };
  }
  if (typeof raw?.source === "number") {
    return { type: "source", sourceIndex: raw.source };
  }
  if (typeof raw?.emitter === "number") {
    return { type: "emitter", emitterIndex: raw.emitter };
  }
  throw new Error(`identifyMappedNode: node ${node.index} has an unrecognized raw shape.`);
}

export function findMappedNode(graph: MappedGraph, index: number): MappedNode | undefined {
  return graph.nodes.find((n) => n.index === index);
}

/** Parses a `map-audio-graph.ts` `portName()`-produced value-in socket id ("in" | "in0" | "in1" | ...) back to a 0-based input-port index. */
export function parseInputSocket(socket: string): number {
  if (socket === "in") return 0;
  const match = /^in(\d+)$/.exec(socket);
  return match ? Number(match[1]) : 0;
}

/** Parses the value-out socket id ("out" | "out0" | "out1" | ...) back to a 0-based output-port index. */
export function parseOutputSocket(socket: string): number {
  if (socket === "out") return 0;
  const match = /^out(\d+)$/.exec(socket);
  return match ? Number(match[1]) : 0;
}
