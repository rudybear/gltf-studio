// This project's own KHR_audio_graph validators (AGH-001), on top of
// vendored AudioGraphJS's own `lintGraph`/`lintLayeredGraph` (which only
// report a generic "Graph contains a cycle" boolean-ish message with no
// node names). These encode the DAG-only decision and several other
// concrete, checkable gaps from /glTF-audio/03-gap-analysis-audio-graph.md,
// updated for spec r2 (rudybear/glTF@KHR_audio_graph PR #2632 @ c0042d7f —
// see audio-node-registry.ts's header comment for the full r2 delta list):
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
//    RESOLVED upstream — the ratified schema defines `periodicWave`/`curve`
//    payloads for both. r2 moved the oscillator payload OFF `graph.nodes[]`
//    entirely (a `KHR_audio_emitter` source's `extensions.KHR_audio_graph
//    .oscillator`, never a node `kind` any more — see `custom-oscillator-
//    undefined` below, which now inspects SOURCES a graph's `inputs[]`
//    references instead of a node). The oscillator half of the runtime gap
//    this comment used to describe (`audio-graph-js@0.1.0`'s
//    `createOscillator` ignoring `periodicWave`) is also RESOLVED: the
//    vendored runtime now builds a real `PeriodicWave` from it
//    (`nodes/oscillator.ts`), so no lint warning is needed for that case
//    any more — an authored `periodicWave` is genuinely audible.
//  - G1 (no DynamicsCompressor node): schema-RESOLVED (`compressor` is one
//    of the 16 `KHR_audio_graph.node.schema.json` `oneOf` kinds,
//    threshold/knee/ratio/attack/release) but still a genuine RUNTIME gap —
//    `audio-graph-js`'s `NodeKind` union / `buildGraph`'s switch
//    (`runtime/buildGraph.js`) has no `'compressor'` case at all, so this
//    vendored runtime cannot build real Web Audio nodes for it
//    (`AudioGraphJsHost.audition()` degrades gracefully rather than
//    throwing — see that file's own doc comment). Distinct in kind from
//    G3/G4/G5, which are actual `KHR_audio_graph` document-model limits no
//    runtime upgrade could route around.
//
// r2 also removed `splitter`'s/`channelmerger`'s authored channel-count
// params (`numberOfOutputs`/`numberOfInputs`) — arity is now DERIVED from
// the highest port index referenced in `connections[]`/`inputs[]` (spec
// rules 9/10; `audio-graph-js`'s `parse-layered.ts` performs this exact
// derivation when building the runtime graph). There is no longer a
// "declared count" a connection could exceed, so the old `channel-port-
// out-of-bounds` bounds check this file used to run is gone — a splitter's
// output arity (a channelmerger's input arity) is unbounded by
// construction now.
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { AudioEmitterSource, KHRGraph, KHRGraphNodeSpec } from "audio-graph-js";

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

/**
 * r2: an oscillator is never a `graph.nodes[]` entry — it is a
 * `KHR_audio_emitter` source with no `audio` and an
 * `extensions.KHR_audio_graph.oscillator` payload, reached only via a
 * graph's `inputs[]`. `custom-oscillator-undefined` (gap-analysis G2's
 * authoring half) now inspects those SOURCES, keyed by the `source:{index}`
 * id `map-audio-graph.ts` already uses for its synthetic source terminal,
 * so the canvas can highlight the right node.
 *
 * Bug fix (code review, r2 migration): this predicate MUST require `typeof
 * source.audio !== "number"` the same way `map-audio-graph.ts`'s
 * `isOscillator`/`AudioSection.tsx`'s `isOscillatorSource` both already do —
 * a malformed source declaring BOTH `audio` and `oscillator` is a clip
 * everywhere else in this app (and the vendored runtime's own
 * `lintLayeredGraph` already flags that combination as its own
 * `"audio-and-oscillator"` error), so this check must not additionally
 * label it "an oscillator" too, which would contradict every other
 * rendering of the same source and confuse the author. Three independent
 * copies of this exact discriminator exist (here, `map-audio-graph.ts`,
 * `AudioSection.tsx`) rather than one shared export, since the three
 * packages involved (`audio-graph`, `audio-canvas`, `app`) don't otherwise
 * share a dependency edge that could host it without a layering change —
 * keep all three in sync if this condition ever changes again.
 */
function findCustomOscillatorSourceIssues(graphIndex: number, graph: KHRGraph, sources: readonly AudioEmitterSource[]): AudioGraphLintResult[] {
  const results: AudioGraphLintResult[] = [];
  for (const input of graph.inputs ?? []) {
    const source = sources[input.source];
    const oscillator = source?.extensions?.KHR_audio_graph?.oscillator;
    const isOscillatorSource = oscillator !== undefined && typeof source?.audio !== "number";
    if (isOscillatorSource && oscillator.type === "custom" && !oscillator.periodicWave) {
      const label = `source:${input.source}`;
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-oscillator-undefined",
        message: `source #${input.source} is an oscillator with type "custom" but no "periodicWave" data — the custom waveform has no defined payload (gap-analysis G2)`,
        nodeIds: [label]
      });
    }
  }
  return results;
}

export function validateGraph(graphIndex: number, graph: KHRGraph, sources: readonly AudioEmitterSource[] = []): AudioGraphLintResult[] {
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

  results.push(...findCustomOscillatorSourceIssues(graphIndex, graph, sources));

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
    if (node.kind === "gain" && node.params?.interpolation === "custom" && !node.params?.curve) {
      results.push({
        graphIndex,
        severity: "warning",
        code: "custom-interpolation-undefined",
        message: `node "${label}" is a gain node with interpolation "custom" but no "curve" data — the custom curve has no defined payload (gap-analysis G2)`,
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
    // valid KHR_audio_graph node kind (16-kind r2 oneOf, threshold/knee/
    // ratio/attack/release), but audio-graph-js's `NodeKind` union /
    // `buildGraph()` switch has no `'compressor'` case, so this vendored
    // runtime cannot build one. `AudioGraphHost.audition()` degrades
    // gracefully (see its own doc comment) rather than throwing, but no
    // sound comes out of this node.
    if (node.kind === "compressor") {
      results.push({
        graphIndex,
        severity: "warning",
        code: "compressor-runtime-unimplemented",
        message: `node "${label}" is a "compressor" — valid per the ratified KHR_audio_graph schema (gap-analysis G1 is resolved upstream), but this project's vendored AudioGraphJS runtime doesn't implement it yet — auditioning a graph reaching this node will not throw, but this node's processing is skipped`,
        nodeIds: [label]
      });
    }
    // r2: an authored "oscillator" node `kind` is no longer legal at all
    // (removed from the node oneOf — see this file's header comment) —
    // this is now a genuinely malformed/legacy-shaped document, not a
    // resolvable v1 gap. The vendored runtime's own `parseLayeredExtensions`
    // already reports it (`"oscillator" is not a graph node kind (found at
    // index N)"`), forwarded by `AudioGraphJsHost.buildGraph` as an
    // `"upstream"` error — no duplicate check needed here.
  });

  return results;
}
