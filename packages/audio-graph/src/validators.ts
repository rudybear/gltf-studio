// This project's own KHR_audio_graph validators (AGH-001), on top of
// vendored AudioGraphJS's own `lintGraph`/`lintLayeredGraph` (which only
// report a generic "Graph contains a cycle" boolean-ish message with no
// node names). These encode the DAG-only decision and several other
// concrete, checkable gaps from /glTF-audio/03-gap-analysis-audio-graph.md:
//
//  - G3 (DAG-only): a cycle is named by its actual node path
//    (specs/ux-audio-graph.md UX-602's "cycle detected (gain → biquadFilter
//    → panner → gain)" example) rather than left as an opaque boolean.
//    KHR_audio_graph's own connection schema (`to: { node, input?: number
//    }`, numeric-only) has no way to target an AudioParam by name, so "no
//    audio-rate parameter modulation" (gap G4) is enforced by construction,
//    not by a validator here — there is nothing a document COULD express
//    that would need flagging.
//  - G5 (no envelopes/scheduled automation): flags any node `params` key
//    that looks like an attempt at one (the schema doesn't define this
//    either, but unlike G4 a document author could plausibly add an
//    `envelope`/`adsr` key that a naive implementation silently ignores).
//  - G2 (`custom` oscillator/interpolation has no defined data model):
//    RESOLVED upstream since the gap analysis was written — the vendored
//    ratified schema (glTF-audio/AudioGraphJS/spec-repo's `KHR_audio_graph
//    .oscillator.schema.json`/`.gain.schema.json`, refreshed with PR #2572's
//    review fixes) now defines `periodicWave`/`curve` payloads for both.
//    What's flagged here now is the RUNTIME half of the gap instead: this
//    project's vendored `audio-graph-js@0.1.0` predates that schema
//    refresh — its `createOscillator` never reads a `periodicWave` param at
//    all (`custom` silently falls back to plain sine), so authoring one is
//    accepted by the schema but has no audible effect through this host yet.
//  - G1 (no DynamicsCompressor node): also RESOLVED upstream — the same
//    schema refresh added a `compressor` node kind
//    (`KHR_audio_graph.compressor.schema.json`, threshold/knee/ratio/
//    attack/release) that `audio-node-registry.ts`'s palette now offers.
//    But `audio-graph-js@0.1.0`'s `NodeKind` union / `buildGraph`'s switch
//    (`runtime/buildGraph.js`) has no `'compressor'` case at all — it is
//    authorable and schema-valid, but this vendored runtime cannot build
//    real Web Audio nodes for it (`AudioGraphJsHost.audition()` degrades
//    gracefully rather than throwing — see that file's own doc comment).
//    Both are genuine RUNTIME/implementation gaps now, not spec gaps —
//    distinct in kind from G3/G4/G5, which are actual `KHR_audio_graph`
//    document-model limits no runtime upgrade could route around.
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph, KHRGraphNodeSpec } from "audio-graph-js";

// `splitter`'s `numberOfOutputs`/`channelmerger`'s `numberOfInputs` are NOT
// part of the ratified `KHR_audio_graph.splitter.schema.json`/
// `.channelmerger.schema.json` (neither declares an explicit channel-count
// param — specs/ux-audio-graph.md's own M7 implementation note calls this
// out) but the vendored AudioGraphJS runtime's `createChannelSplitter`/
// `createChannelMerger` DO read them (`numberOfOutputs ?? 6`/
// `numberOfInputs ?? 2`), and `audio-node-registry.ts` accepted
// `channelmerger`'s `numberOfInputs` as an implementation-defined `params`
// key even before this PR — params objects have no `additionalProperties:
// false`, so an extra runtime-meaningful key is schema-legal. This PR adds
// the missing symmetric `numberOfOutputs` splitter field (UX-615) and this
// bounds check: a connection whose `output`/`input` index exceeds the
// node's declared count would fail at real Web Audio `connect()` time.
const SPLITTER_KIND = "splitter";
const CHANNELMERGER_KIND = "channelmerger";

/** Every `connections[]` entry's `output` (for a `splitter`) or `input` (for a `channelmerger`) index at `nodeIndex` that is `>= declaredCount`, sorted ascending and de-duplicated. */
function channelPortsOutOfBounds(graph: KHRGraph, nodeIndex: number, kind: string, declaredCount: number): number[] {
  const bad = new Set<number>();
  for (const connection of graph.connections) {
    if (kind === SPLITTER_KIND && connection.from.node === nodeIndex) {
      const output = connection.from.output ?? 0;
      if (output >= declaredCount) bad.add(output);
    }
    if (kind === CHANNELMERGER_KIND && connection.to.node === nodeIndex) {
      const input = connection.to.input ?? 0;
      if (input >= declaredCount) bad.add(input);
    }
  }
  return [...bad].sort((a, b) => a - b);
}

function nodeLabel(graph: KHRGraph, index: number): string {
  return graph.nodes[index]?.label ?? `node_${index}`;
}

/** DFS cycle search over the RAW KHR_audio_graph node/connection indices, returning the actual cycle path (node labels) if found. */
export function findCyclePath(graph: KHRGraph): string[] | null {
  const adjacency = new Map<number, number[]>();
  for (let i = 0; i < graph.nodes.length; i += 1) {
    adjacency.set(i, []);
  }
  for (const connection of graph.connections) {
    adjacency.get(connection.from.node)?.push(connection.to.node);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const stack: number[] = [];

  function visit(node: number): number[] | null {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) {
      return null;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const found = visit(next);
      if (found) {
        return found;
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (!visited.has(i)) {
      const cycle = visit(i);
      if (cycle) {
        return cycle.map((index) => nodeLabel(graph, index));
      }
    }
  }
  return null;
}

const ENVELOPE_KEY_PATTERN = /envelope|adsr|automation/i;

function findEnvelopeLikeParams(node: KHRGraphNodeSpec): string[] {
  return Object.keys(node.params ?? {}).filter((key) => ENVELOPE_KEY_PATTERN.test(key));
}

export function validateGraph(graphIndex: number, graph: KHRGraph): AudioGraphLintResult[] {
  const results: AudioGraphLintResult[] = [];

  const cycle = findCyclePath(graph);
  if (cycle) {
    results.push({
      graphIndex,
      severity: "error",
      code: "cycle",
      message: `cycle detected (${cycle.join(" → ")}) — KHR_audio_graph is DAG-only in v1 (no cycles, envelopes, or param-modulation)`,
      nodeIds: cycle
    });
  }

  graph.nodes.forEach((node, index) => {
    const label = nodeLabel(graph, index);
    const envelopeKeys = findEnvelopeLikeParams(node);
    if (envelopeKeys.length > 0) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "envelope-unsupported",
        message: `node "${label}" has ${envelopeKeys.map((k) => `"${k}"`).join(", ")} param(s), but envelopes/scheduled automation are not supported in v1 (gap-analysis G5) — use KHR_animation_pointer for k-rate control instead`,
        nodeIds: [label]
      });
    }
    if (node.kind === "oscillator" && node.params?.type === "custom" && !node.params?.periodicWave) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-oscillator-undefined",
        message: `node "${label}" is an oscillator with type "custom" but no "periodicWave" data — the custom waveform has no defined payload (gap-analysis G2)`,
        nodeIds: [label]
      });
    }
    if (node.kind === "gain" && node.params?.interpolation === "custom" && !node.params?.curve) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-interpolation-undefined",
        message: `node "${label}" is a gain node with interpolation "custom" but no "curve" data — the custom curve has no defined payload (gap-analysis G2)`,
        nodeIds: [label]
      });
    }
    // G2 RESOLVED-in-schema / runtime-not-yet-caught-up: once periodicWave/
    // curve IS authored (schema-valid), this project's vendored
    // audio-graph-js@0.1.0 still doesn't apply it — a distinct, more
    // specific warning than the "undefined payload" ones above (which stop
    // firing once the payload exists) so the author isn't left thinking a
    // correctly-authored curve/periodicWave is silently broken by THEM.
    if (node.kind === "oscillator" && node.params?.type === "custom" && node.params?.periodicWave) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "oscillator-periodicwave-runtime-unimplemented",
        message: `node "${label}" has oscillator "periodicWave" data (schema-valid) but this project's vendored AudioGraphJS runtime (audio-graph-js@0.1.0) doesn't build a PeriodicWave from it yet — audition falls back to a plain sine for this node until the vendored runtime is upgraded`,
        nodeIds: [label]
      });
    }
    if (node.kind === "gain" && node.params?.interpolation === "custom" && Array.isArray(node.params?.curve)) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "gain-curve-runtime-unimplemented",
        message: `node "${label}" has a gain "curve" (schema-valid) but this project's vendored AudioGraphJS runtime approximates custom gain interpolation with an exponential ramp instead of sampling the authored curve — audition won't be curve-accurate until the vendored runtime is upgraded`,
        nodeIds: [label]
      });
    }
    // G1 RESOLVED-in-schema / runtime-not-yet-caught-up: `compressor` is a
    // valid KHR_audio_graph node kind (the ratified schema's PR #2572
    // review-fixes refresh added it — see this file's header comment), but
    // audio-graph-js@0.1.0's NodeKind union / buildGraph() switch has no
    // 'compressor' case, so this vendored runtime cannot build one.
    // AudioGraphHost.audition() degrades gracefully (see its own doc
    // comment) rather than throwing, but no sound comes out of this node.
    if (node.kind === "compressor") {
      results.push({
        graphIndex,
        severity: "warning",
        code: "compressor-runtime-unimplemented",
        message: `node "${label}" is a "compressor" — valid per the ratified KHR_audio_graph schema (gap-analysis G1 is resolved upstream), but this project's vendored AudioGraphJS runtime (audio-graph-js@0.1.0) doesn't implement it yet — auditioning a graph reaching this node will not throw, but this node's processing is skipped`,
        nodeIds: [label]
      });
    }
    if (node.kind === SPLITTER_KIND || node.kind === CHANNELMERGER_KIND) {
      const declared = node.kind === SPLITTER_KIND ? Number(node.params?.numberOfOutputs ?? 2) : Number(node.params?.numberOfInputs ?? 2);
      const bad = channelPortsOutOfBounds(graph, index, node.kind, declared);
      if (bad.length > 0) {
        const portWord = node.kind === SPLITTER_KIND ? "output" : "input";
        results.push({
          graphIndex,
          severity: "error",
          code: "channel-port-out-of-bounds",
          message: `node "${label}" is a ${node.kind === SPLITTER_KIND ? "splitter" : "channel merger"} declared with ${declared} ${portWord}${declared === 1 ? "" : "s"}, but ${bad.length === 1 ? "a connection references" : "connections reference"} ${portWord} index ${bad.join(", ")} — increase its "${node.kind === SPLITTER_KIND ? "numberOfOutputs" : "numberOfInputs"}" param or rewire the out-of-range connection`,
          nodeIds: [label]
        });
      }
    }
  });

  return results;
}
