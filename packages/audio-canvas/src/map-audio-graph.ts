// Pure mapping from a raw KHR_audio_graph `graph` JSON object (as found at
// `json.extensions.KHR_audio_graph.graphs[N]`) to the SAME `MappedGraph`
// shape @gltf-studio/graph-canvas's `mapGraph` produces for KHR_interactivity
// (specs/ux-audio-graph.md UX-600) — GraphView/NodeDetails render either
// output identically. No React Flow/ELK/rendering code lives in this file;
// see audio-graph-canvas.tsx for that.
//
// Two kinds of node this projection ADDS that are not literal entries in
// `graph.nodes[]`, mirroring how AudioGraphJS's own `parseLayeredExtensions`
// (`serialization/parse-layered.ts`) builds its runtime `GraphSpec`:
//   - a synthetic `audio-buffer-source` node per `graph.inputs[]` entry (the
//     KHR_audio_emitter source feeding this graph) — kind
//     "audio-buffer-source", zero inputs. r2: this ONE synthetic kind covers
//     BOTH an ordinary audio-clip source (`source.audio` set) and an
//     oscillator source (`source.audio` absent,
//     `source.extensions.KHR_audio_graph.oscillator` set — never a
//     `graph.nodes[]` "oscillator" kind any more) — the subtitle below tells
//     them apart;
//   - a synthetic `emitter` node per `graph.outputs[]` entry (specs/ux-audio-
//     graph.md's UX-607 terminal node), labeled with the target emitter's
//     name/index — zero outputs.
// Both make the canvas show the graph's actual signal path end-to-end
// (source -> processing chain -> emitter) rather than only the interior
// processing nodes `graph.nodes[]` itself enumerates.
import type { MappedEdge, MappedGraph, MappedNode, MappedPort } from "@gltf-studio/graph-canvas";
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { AudioEmitter, AudioEmitterSource, KHRGraph } from "audio-graph-js";

/** UX-605: every audio-graph port is this one type — no `flow` ports appear on this canvas. */
export const AUDIO_PORT_TYPE = "audio";
/** UX-601: this canvas's one node category (distinct from every behavior-graph category color — see palette.ts's "audio" entry). */
export const AUDIO_CATEGORY = "audio";

interface LogicalNode {
  id: string;
  kind: string;
  subtitle?: string;
  raw: unknown;
  inputs: Set<number>;
  outputs: Set<number>;
}

function portName(indices: Set<number>, index: number): string {
  return indices.size <= 1 ? "in" : `in${index}`;
}

/**
 * M7 audio-graph editing: a freshly-`AudioGraphEdit.addNode`-ed node has no
 * `connections[]`/`inputs[]`/`outputs[]` entry touching it yet, so a purely
 * wiring-derived port set would give it ZERO ports — nothing to drag a new
 * connection onto or from, a chicken-and-egg dead end for a brand new node.
 * Every node kind's single ALWAYS-present side gets its "slot 0" seeded by
 * default: 1 input + 1 output (the common case — gain/delay/waveshaper/the
 * 8 filter kinds/splitter/channelmerger/channelmixer/audiomixer/compressor;
 * r2 removed the pure-source `oscillator` node kind entirely — see this
 * file's header comment — so there is no longer a 0-input case here).
 * `audiomixer`'s "many inputs summed" Web Audio semantics still collapses
 * to one input slot 0 here — `AudioGraphEdit.connectAudio`'s "last write
 * wins" per-input-slot overwrite policy (DOC-059) means only ONE producer
 * is representable per slot regardless, a deliberate v1 simplification (see
 * that factory's own doc comment).
 *
 * r2 (supersedes UX-615's authored-arity fix): `splitter`'s output count
 * and `channelmerger`'s input count are no longer authorable at all (no
 * `numberOfOutputs`/`numberOfInputs` params — spec rules 9/10 derive both
 * from the highest port index referenced in `connections[]`/`inputs[]`,
 * `@gltf-audiograph/kernel`'s `ports.ts` reports both as `Infinity`). This
 * function only seeds slot 0; growing a splitter's/channelmerger's fan port
 * count past whatever wiring already uses is `growFanPorts`'s job, below —
 * it adds exactly one extra, not-yet-wired "next" slot after the highest
 * used index so the canvas stays draggable-to-grow instead of needing an
 * authored count to unlock a new port.
 */
function defaultPortSlots(): { inputs: number[]; outputs: number[] } {
  return { inputs: [0], outputs: [0] };
}

/** r2 fan-port growth (see `defaultPortSlots`'s doc comment): called once ALL real wiring (`connections[]`/`inputs[]`/`outputs[]`) has already been unioned into `entry.inputs`/`entry.outputs`, so `Math.max` sees the true highest used index. A `splitter` always gets one spare, unused OUTPUT past its highest-used one; a `channelmerger` always gets one spare, unused INPUT past its highest-used one — never the reverse (a splitter's single input and a channelmerger's single output are both fixed, ordinary slot-0 sides, not derived). */
function growFanPorts(kind: string, entry: LogicalNode): void {
  if (kind === "splitter") {
    const maxOutput = entry.outputs.size > 0 ? Math.max(...entry.outputs) : -1;
    entry.outputs.add(maxOutput + 1);
  }
  if (kind === "channelmerger") {
    const maxInput = entry.inputs.size > 0 ? Math.max(...entry.inputs) : -1;
    entry.inputs.add(maxInput + 1);
  }
}

/** Extracts, per this graph's lint results, the set of node LABELS implicated in a "cycle" violation. */
function cycleLabelsFor(graphIndex: number, lintResults: AudioGraphLintResult[]): Set<string> {
  const labels = new Set<string>();
  for (const result of lintResults) {
    if (result.graphIndex === graphIndex && result.code === "cycle") {
      for (const id of result.nodeIds) labels.add(id);
    }
  }
  return labels;
}

export function mapAudioGraph(
  graph: KHRGraph,
  graphIndex: number,
  emitters: AudioEmitter[] = [],
  lintResults: AudioGraphLintResult[] = [],
  sources: AudioEmitterSource[] = []
): MappedGraph {
  const byId = new Map<string, LogicalNode>();
  const order: string[] = [];
  // rawIndex -> label, using the SAME fallback validators.ts's findCyclePath uses, so cycle nodeIds (labels) map back to a real node here.
  const labelOfRawIndex = new Map<number, string>();

  function ensure(id: string, init: () => LogicalNode): LogicalNode {
    let entry = byId.get(id);
    if (!entry) {
      entry = init();
      byId.set(id, entry);
      order.push(id);
    }
    return entry;
  }

  graph.nodes.forEach((node, i) => {
    const label = node.label ?? `node_${i}`;
    labelOfRawIndex.set(i, label);
    const defaults = defaultPortSlots();
    ensure(`node:${i}`, () => ({
      id: `node:${i}`,
      kind: node.kind,
      subtitle: node.label,
      raw: node,
      inputs: new Set(defaults.inputs),
      outputs: new Set(defaults.outputs)
    }));
  });

  for (const connection of graph.connections) {
    byId.get(`node:${connection.from.node}`)?.outputs.add(connection.from.output ?? 0);
    byId.get(`node:${connection.to.node}`)?.inputs.add(connection.to.input ?? 0);
  }

  for (const input of graph.inputs ?? []) {
    const sourceId = `source:${input.source}`;
    const source = sources[input.source];
    const oscillator = source?.extensions?.KHR_audio_graph?.oscillator;
    // r2: a source with no `audio` index and an `extensions.KHR_audio_graph
    // .oscillator` payload is an oscillator source (never a graph node kind
    // any more — see this file's header comment); every other source is an
    // ordinary audio clip. Kept in sync with two other independent copies
    // of this exact discriminator — `@gltf-studio/audio-graph`'s
    // `validators.ts` (`findCustomOscillatorSourceIssues`) and
    // `packages/app`'s `AudioSection.tsx` (`isOscillatorSource`) — see
    // `validators.ts`'s doc comment for why these three aren't unified into
    // one shared export.
    const isOscillator = oscillator !== undefined && typeof source?.audio !== "number";
    ensure(sourceId, () => ({
      id: sourceId,
      kind: "audio-buffer-source",
      subtitle: isOscillator ? `oscillator source #${input.source} (${oscillator.type ?? "sine"})` : `KHR_audio_emitter source #${input.source}`,
      // UX-617 (Track 1 gap closure): carries the SOURCE entity's own
      // `extras` through so `graph-view.tsx`'s generic `node.raw.extras
      // ?.gltfi` position convention (DOC-058's doc comment) picks up a
      // persisted position for this synthetic terminal too — written by
      // `SceneEdit.setAudioSourceProperty` (DOC-062), not by any
      // `AudioGraphEdit` factory (this is not a `graph.nodes[]` entry).
      raw: { source: input.source, extras: sources[input.source]?.extras },
      inputs: new Set(),
      outputs: new Set([0])
    }));
    byId.get(`node:${input.node}`)?.inputs.add(input.input ?? 0);
  }

  for (const output of graph.outputs ?? []) {
    const emitterId = `emitter:${output.emitter}`;
    ensure(emitterId, () => ({
      id: emitterId,
      kind: "emitter",
      // UX-607: the terminal node's "config names the scene audio emitter it feeds".
      subtitle: emitters[output.emitter]?.name ?? `emitter #${output.emitter}`,
      // UX-617: see the source terminal's identical `extras` note above — written by `SceneEdit.setAudioEmitterProperty`.
      raw: { emitter: output.emitter, extras: emitters[output.emitter]?.extras },
      inputs: new Set([0]),
      outputs: new Set() // UX-607: "it has no outputs"
    }));
    byId.get(`node:${output.node}`)?.outputs.add(output.output ?? 0);
  }

  // r2 fan-port growth (see `growFanPorts`'s doc comment): runs LAST, once
  // every real wiring source (`connections[]`/`inputs[]`/`outputs[]` above)
  // has already been unioned into each node's `inputs`/`outputs` sets.
  graph.nodes.forEach((node, i) => {
    const entry = byId.get(`node:${i}`);
    if (entry) growFanPorts(node.kind, entry);
  });

  const indexOf = new Map<string, number>();
  order.forEach((id, index) => indexOf.set(id, index));

  const highlightedLabels = cycleLabelsFor(graphIndex, lintResults);
  const highlightedIndices = new Set<number>();
  for (const [rawIndex, label] of labelOfRawIndex) {
    if (highlightedLabels.has(label)) {
      const idx = indexOf.get(`node:${rawIndex}`);
      if (idx !== undefined) highlightedIndices.add(idx);
    }
  }

  const nodes: MappedNode[] = order.map((id) => {
    const entry = byId.get(id)!;
    const ports: MappedPort[] = [];
    for (const index of [...entry.inputs].sort((a, b) => a - b)) {
      const name = portName(entry.inputs, index);
      ports.push({ id: `value-in:${name}`, name, kind: "value-in", type: AUDIO_PORT_TYPE });
    }
    for (const index of [...entry.outputs].sort((a, b) => a - b)) {
      const name = entry.outputs.size <= 1 ? "out" : `out${index}`;
      ports.push({ id: `value-out:${name}`, name, kind: "value-out", type: AUDIO_PORT_TYPE });
    }
    return {
      index: indexOf.get(id)!,
      op: entry.kind,
      category: AUDIO_CATEGORY,
      label: entry.kind,
      subtitle: entry.subtitle,
      knownSpec: true,
      ports,
      literals: {},
      raw: entry.raw
    };
  });

  const edges: MappedEdge[] = [];
  graph.connections.forEach((connection, i) => {
    const sourceNode = indexOf.get(`node:${connection.from.node}`);
    const targetNode = indexOf.get(`node:${connection.to.node}`);
    if (sourceNode === undefined || targetNode === undefined) {
      return;
    }
    const sourceEntry = byId.get(`node:${connection.from.node}`)!;
    const targetEntry = byId.get(`node:${connection.to.node}`)!;
    const outIndex = connection.from.output ?? 0;
    const inIndex = connection.to.input ?? 0;
    const sourcePortName = sourceEntry.outputs.size <= 1 ? "out" : `out${outIndex}`;
    const targetPortName = portName(targetEntry.inputs, inIndex);
    edges.push({
      id: `${graphIndex}:conn:${i}`,
      kind: "value",
      sourceNode,
      sourcePort: `value-out:${sourcePortName}`,
      targetNode,
      targetPort: `value-in:${targetPortName}`,
      type: AUDIO_PORT_TYPE,
      // UX-603: the edge that closes a cycle is drawn dashed rather than hidden.
      invalid: highlightedIndices.has(sourceNode) && highlightedIndices.has(targetNode)
    });
  });

  (graph.inputs ?? []).forEach((input, i) => {
    const sourceNode = indexOf.get(`source:${input.source}`);
    const targetNode = indexOf.get(`node:${input.node}`);
    if (sourceNode === undefined || targetNode === undefined) {
      return;
    }
    const targetEntry = byId.get(`node:${input.node}`)!;
    const targetPortName = portName(targetEntry.inputs, input.input ?? 0);
    edges.push({
      id: `${graphIndex}:input:${i}`,
      kind: "value",
      sourceNode,
      sourcePort: "value-out:out",
      targetNode,
      targetPort: `value-in:${targetPortName}`,
      type: AUDIO_PORT_TYPE
    });
  });

  (graph.outputs ?? []).forEach((output, i) => {
    const sourceNode = indexOf.get(`node:${output.node}`);
    const targetNode = indexOf.get(`emitter:${output.emitter}`);
    if (sourceNode === undefined || targetNode === undefined) {
      return;
    }
    const sourceEntry = byId.get(`node:${output.node}`)!;
    const sourcePortName = sourceEntry.outputs.size <= 1 ? "out" : `out${output.output ?? 0}`;
    edges.push({
      id: `${graphIndex}:output:${i}`,
      kind: "value",
      sourceNode,
      sourcePort: `value-out:${sourcePortName}`,
      targetNode,
      targetPort: "value-in:in",
      type: AUDIO_PORT_TYPE
    });
  });

  return {
    graphIndex,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    variableCount: 0,
    eventCount: 0,
    nodes,
    edges,
    warnings: []
  };
}
