// AudioGraphEdit command factories (DOC-056..059 — see specs/document-model.md):
// undoable RFC-6902 commands over `extensions.KHR_audio_graph.graphs[graphIndex]`,
// the sibling of `GraphEdit` (graph-edit.ts) for `KHR_interactivity`. Mirrors
// that file's shape exactly — every factory reads the CURRENT
// `EditorDocument.json`, computes a `PatchPair` via edit-fragments.ts's
// primitives, and returns a `Command` — but `KHR_audio_graph`'s wiring is
// structurally different from `KHR_interactivity`'s: connections are entries
// in `connections[]`/`inputs[]`/`outputs[]` ARRAYS (`{from,to}` objects keyed
// by numeric node/port indices), not per-socket maps on the node itself. So
// `connectAudio`/`disconnectAudio`/`removeAudioNode`'s fixups all replace one
// of those three arrays WHOLESALE (compute the next array value from the
// CURRENT one, emit one `replace` patch + its exact-prior-value inverse)
// rather than porting `graph-edit.ts`'s per-key `setPathFragment`/
// `fixupReferences` approach, which was designed for object-keyed
// values/flows maps and per-element node-index-shift patches respectively —
// neither shape fits an array of connection objects. Whole-array replace
// also sidesteps DOC-019-style patch-ordering hazards entirely: every
// fragment here is computed against the SAME pre-edit `document.json`, and
// because `nodes[nodeIndex]`, `connections`, `inputs`, and `outputs` are
// four disjoint paths, combining their patches in any order applies cleanly.
//
// Position storage (OPEN(UX-audiograph-position-tbd), resolved by DOC-058):
// `KHR_audio_graph.node.schema.json` allows `extras` on every node the same
// way glTF's own `nodes[]` does, so `setAudioNodePosition` reuses DOC-027's
// exact convention (`extras.gltfi.{x,y}`) one level down, at
// `graph.nodes[nodeIndex].extras.gltfi` — `graph-view.tsx`'s `nodePosition()`
// already reads `node.raw.extras?.gltfi` generically off whatever object
// `MappedNode.raw` is, so this requires no change to the shared canvas at
// all. Only apply to REAL processing nodes (`graph.nodes[]`); the synthetic
// `audio-buffer-source`/`emitter` terminal nodes `map-audio-graph.ts`
// projects from `inputs[]`/`outputs[]` are not owned by this graph (they
// reflect `KHR_audio_emitter` sources/emitters) and have no home for
// `extras` here — callers should not call `setAudioNodePosition` for them
// (`audio-canvas`'s wiring layer guards this; see its own doc comments).
import type { Command } from "./command.js";
import { combineCommandParts, makeCommandId } from "./command.js";
import { appendFragment, setPathFragment, type PatchPair } from "./edit-fragments.js";
import { formatPointer, getIn } from "./json-pointer.js";
import type { EditorDocument } from "./document.js";

/**
 * Minimal structural mirror of `audio-graph-js`'s own `KHRGraph`/
 * `KHRGraphNodeSpec`/`KHRGraphConnection`/`GraphInput`/`GraphOutput` types
 * (`packages/audio-graph`'s dependency) — declared locally rather than
 * imported so this file only takes a TYPE-ONLY dependency on the vendored
 * package (no runtime import), the same posture `graph-edit.ts` takes on
 * `@gltfi/ir`'s `Graph`/`GraphNode` shapes.
 */
export interface AudioGraphNodeSpec {
  kind: string;
  params: Record<string, unknown>;
  label?: string;
  bypass?: boolean;
  extras?: { gltfi?: { x: number; y: number }; [key: string]: unknown };
}
export interface AudioGraphConnectionSpec {
  from: { node: number; output?: number };
  to: { node: number; input?: number };
}
export interface AudioGraphInputSpec {
  source: number;
  node: number;
  input?: number;
}
export interface AudioGraphOutputSpec {
  node: number;
  output?: number;
  emitter: number;
}
export interface AudioGraphSpec {
  name?: string;
  nodes: AudioGraphNodeSpec[];
  connections: AudioGraphConnectionSpec[];
  inputs?: AudioGraphInputSpec[];
  outputs?: AudioGraphOutputSpec[];
}

/** DOC-056: an edit-side endpoint naming either a real `graph.nodes[]` entry or a `KHR_audio_emitter` source (the projection's synthetic `audio-buffer-source` node). */
export type AudioEndpointSource = { kind: "node"; index: number; output?: number } | { kind: "source"; sourceIndex: number };
/** DOC-056: an edit-side endpoint naming either a real `graph.nodes[]` entry or a `KHR_audio_emitter` emitter (the projection's synthetic terminal `emitter` node, UX-607). */
export type AudioEndpointTarget = { kind: "node"; index: number; input?: number } | { kind: "emitter"; emitterIndex: number };

/** Exported so `@gltf-studio/audio-canvas` (the one caller outside this file that needs to compute an `extensions.KHR_audio_graph.graphs[N]` sub-path, e.g. to read `nodes.length` before an add) shares this single definition instead of keeping its own copy. */
export function graphPath(graphIndex: number): (string | number)[] {
  return ["extensions", "KHR_audio_graph", "graphs", graphIndex];
}

function getAudioGraph(json: unknown, graphIndex: number): AudioGraphSpec {
  const graph = getIn(json, graphPath(graphIndex).map(String)) as AudioGraphSpec | undefined;
  if (!graph) {
    throw new Error(`No KHR_audio_graph graph at index ${graphIndex}.`);
  }
  return graph;
}

/** Whole-array replace helper (this file's uniform strategy — see header comment): `path` must already exist as an array (`existing` is that array's CURRENT value). */
function replaceArrayFragment(path: (string | number)[], existing: unknown[], next: unknown[]): PatchPair {
  const pointer = formatPointer(path);
  return {
    patches: [{ op: "replace", path: pointer, value: next }],
    inverse: [{ op: "replace", path: pointer, value: existing }]
  };
}

function shiftIndex(index: number, removedIndex: number): number {
  return index > removedIndex ? index - 1 : index;
}

/** `removeNode`'s `inputs[]`/`outputs[]` fixup: both are flat `{node, ...}` arrays needing the identical drop-if-equal/shift-if-above treatment (unlike `connections[]`, whose two NESTED node refs — `from.node`/`to.node` — don't fit this shape). */
function dropAndShiftByNode<T extends { node: number }>(list: T[], removedIndex: number): T[] {
  return list.filter((item) => item.node !== removedIndex).map((item) => ({ ...item, node: shiftIndex(item.node, removedIndex) }));
}

/** `connectAudio`'s shared "overwrite whatever currently targets the same identity, then append" step, combined with `replaceArrayFragment` into one ready-to-return `Command` — the three `connectAudio` branches differ only in which array/predicate/entry/label they pass in. */
function connectInto<T>(path: (string | number)[], existing: T[], matchesTarget: (item: T) => boolean, entry: T, label: string): Command {
  const next = existing.filter((item) => !matchesTarget(item)).concat(entry);
  const fragment = replaceArrayFragment(path, existing, next);
  return { id: makeCommandId("connect-audio"), label, patches: fragment.patches, inverse: fragment.inverse };
}

/** `disconnectAudio`'s shared "remove the one entry matching `to`, if any" step — returns `undefined` (not a no-op `Command`) when nothing matched, so callers can try the next candidate array before finally throwing. */
function tryRemoveMatching<T>(path: (string | number)[], existing: T[], matches: (item: T) => boolean, label: string): Command | undefined {
  if (!existing.some(matches)) return undefined;
  const next = existing.filter((item) => !matches(item));
  const fragment = replaceArrayFragment(path, existing, next);
  return { id: makeCommandId("disconnect-audio"), label, patches: fragment.patches, inverse: fragment.inverse };
}

export const AudioGraphEdit = {
  /**
   * DOC-056: find-or-scaffolds `extensions.KHR_audio_graph.graphs[graphIndex]`
   * (empty `nodes`/`connections` arrays) plus an `extensionsUsed` entry —
   * mirrors `GraphEdit.ensureGraph`. A no-op command when the graph already
   * exists. `KHR_audio_graph.graph.schema.json` technically requires
   * `nodes.minItems: 1`, the same transient-invalid-until-first-node
   * posture `GraphEdit.ensureGraph`'s empty `nodes: []` scaffold already
   * accepts for `KHR_interactivity` — resolved the same way here.
   */
  ensureGraph(document: EditorDocument, graphIndex = 0): Command {
    const existingExtension = getIn(document.json, ["extensions", "KHR_audio_graph"]) as { graphs?: AudioGraphSpec[] } | undefined;
    const existingGraphs = existingExtension?.graphs ?? [];
    if (existingGraphs[graphIndex] !== undefined) {
      return { id: makeCommandId("ensure-audio-graph"), label: "Ensure audio graph", patches: [], inverse: [] };
    }

    const graphs = existingGraphs.slice();
    while (graphs.length <= graphIndex) {
      graphs.push({ nodes: [], connections: [] });
    }
    const extFragment = setPathFragment(document.json, ["extensions", "KHR_audio_graph"], { graphs });

    const extensionsUsed = (getIn(document.json, ["extensionsUsed"]) as string[] | undefined) ?? [];
    const usedFragment: PatchPair = extensionsUsed.includes("KHR_audio_graph")
      ? { patches: [], inverse: [] }
      : appendFragment(document.json, ["extensionsUsed"], "KHR_audio_graph");

    const combined = combineCommandParts([usedFragment, extFragment]);
    return { id: makeCommandId("ensure-audio-graph"), label: "Ensure audio graph", patches: combined.patches, inverse: combined.inverse };
  },

  /** DOC-057: appends a new audio-graph node (`kind` + `params`, per `KHR_audio_graph.node.schema.json`'s per-kind `oneOf`), optionally labeled and positioned (DOC-058). */
  addNode(
    document: EditorDocument,
    graphIndex: number,
    kind: string,
    params: Record<string, unknown>,
    opts: { label?: string; position?: { x: number; y: number } } = {}
  ): Command {
    getAudioGraph(document.json, graphIndex); // throws if missing — callers use ensureGraph first when it might not exist
    const node: AudioGraphNodeSpec = { kind, params: { ...params } };
    if (opts.label) node.label = opts.label;
    if (opts.position) node.extras = { gltfi: { x: opts.position.x, y: opts.position.y } };

    const nodesArrayPath = [...graphPath(graphIndex), "nodes"];
    const fragment = appendFragment(document.json, nodesArrayPath, node);
    return {
      id: makeCommandId("add-audio-node"),
      label: `Add audio node "${kind}"`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-057: removes `graph.nodes[nodeIndex]` and rewrites `connections[]`/
   * `inputs[]`/`outputs[]` (whichever exist) to drop every entry that
   * referenced it and shift every surviving node-index reference above it
   * down by one — this file's whole-array-replace strategy (header
   * comment), computed here in one pass rather than via `fixup-
   * references.ts` (none of its five `ReferenceKind`s fit an array of
   * connection objects; see that module's own doc comment for the five it
   * does cover).
   */
  removeNode(document: EditorDocument, graphIndex: number, nodeIndex: number): Command {
    const graph = getAudioGraph(document.json, graphIndex);
    const removedNode = graph.nodes[nodeIndex];
    if (removedNode === undefined) {
      throw new Error(`No audio-graph node at index ${nodeIndex} in graph ${graphIndex}.`);
    }

    const parts: PatchPair[] = [];

    const nextConnections = graph.connections
      .filter((c) => c.from.node !== nodeIndex && c.to.node !== nodeIndex)
      .map((c) => ({
        from: { ...c.from, node: shiftIndex(c.from.node, nodeIndex) },
        to: { ...c.to, node: shiftIndex(c.to.node, nodeIndex) }
      }));
    parts.push(replaceArrayFragment([...graphPath(graphIndex), "connections"], graph.connections, nextConnections));

    if (graph.inputs) {
      parts.push(replaceArrayFragment([...graphPath(graphIndex), "inputs"], graph.inputs, dropAndShiftByNode(graph.inputs, nodeIndex)));
    }

    if (graph.outputs) {
      parts.push(replaceArrayFragment([...graphPath(graphIndex), "outputs"], graph.outputs, dropAndShiftByNode(graph.outputs, nodeIndex)));
    }

    const nodePath = [...graphPath(graphIndex), "nodes", nodeIndex];
    parts.push({
      patches: [{ op: "remove", path: formatPointer(nodePath) }],
      inverse: [{ op: "add", path: formatPointer(nodePath), value: removedNode }]
    });

    const combined = combineCommandParts(parts);
    return {
      id: makeCommandId("remove-audio-node"),
      label: `Remove audio node ${nodeIndex}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * DOC-059: wires `from -> to`, overwriting any existing wiring already
   * feeding `to` (the same "last write wins" semantics `GraphEdit
   * .connectValue`'s per-socket map naturally has, reproduced here for the
   * array-shaped `connections[]`/`inputs[]`/`outputs[]` by first dropping
   * any existing entry that targets the SAME `to` identity, then appending
   * the new one) — `source -> emitter` (bypassing every processing node) is
   * rejected: neither `inputs[]` nor `outputs[]` can express a direct
   * source/emitter binding (`KHR_audio_graph.input.schema.json`/`.output
   * .schema.json` both require a `node`), so there is no array this could
   * append to.
   */
  connectAudio(document: EditorDocument, graphIndex: number, from: AudioEndpointSource, to: AudioEndpointTarget): Command {
    const graph = getAudioGraph(document.json, graphIndex);

    if (from.kind === "node" && to.kind === "node") {
      const connection: AudioGraphConnectionSpec = {
        from: { node: from.index, output: from.output ?? 0 },
        to: { node: to.index, input: to.input ?? 0 }
      };
      return connectInto(
        [...graphPath(graphIndex), "connections"],
        graph.connections,
        (c) => c.to.node === connection.to.node && (c.to.input ?? 0) === (connection.to.input ?? 0),
        connection,
        `Connect audio node ${from.index} -> node ${to.index}`
      );
    }

    if (from.kind === "source" && to.kind === "node") {
      const input: AudioGraphInputSpec = { source: from.sourceIndex, node: to.index, input: to.input ?? 0 };
      return connectInto(
        [...graphPath(graphIndex), "inputs"],
        graph.inputs ?? [],
        (i) => i.node === input.node && (i.input ?? 0) === (input.input ?? 0),
        input,
        `Connect source ${from.sourceIndex} -> node ${to.index}`
      );
    }

    if (from.kind === "node" && to.kind === "emitter") {
      const output: AudioGraphOutputSpec = { node: from.index, output: from.output ?? 0, emitter: to.emitterIndex };
      return connectInto([...graphPath(graphIndex), "outputs"], graph.outputs ?? [], (o) => o.emitter === output.emitter, output, `Connect node ${from.index} -> emitter ${to.emitterIndex}`);
    }

    throw new Error("connectAudio: cannot connect a KHR_audio_emitter source directly to an emitter — route it through a processing node.");
  },

  /**
   * DOC-059: removes whatever currently feeds `to` — searches `connections[]`
   * (node -> node), `inputs[]` (source -> node), and `outputs[]` (node ->
   * emitter), whichever has a matching entry (structurally, at most one
   * does). Throws if none matches, mirroring `GraphEdit.disconnect`'s
   * `deletePathFragment` (which throws when nothing exists at the target
   * path) — the canvas only ever calls this on an edge it just rendered, so
   * "nothing to disconnect" indicates a real caller bug, not a normal path.
   */
  disconnectAudio(document: EditorDocument, graphIndex: number, to: AudioEndpointTarget): Command {
    const graph = getAudioGraph(document.json, graphIndex);

    if (to.kind === "node") {
      const targetInput = to.input ?? 0;
      const viaConnections = tryRemoveMatching(
        [...graphPath(graphIndex), "connections"],
        graph.connections,
        (c) => c.to.node === to.index && (c.to.input ?? 0) === targetInput,
        `Disconnect audio into node ${to.index}`
      );
      if (viaConnections) return viaConnections;
      const viaInputs = tryRemoveMatching(
        [...graphPath(graphIndex), "inputs"],
        graph.inputs ?? [],
        (i) => i.node === to.index && (i.input ?? 0) === targetInput,
        `Disconnect source feed into node ${to.index}`
      );
      if (viaInputs) return viaInputs;
    } else {
      const viaOutputs = tryRemoveMatching([...graphPath(graphIndex), "outputs"], graph.outputs ?? [], (o) => o.emitter === to.emitterIndex, `Disconnect audio into emitter ${to.emitterIndex}`);
      if (viaOutputs) return viaOutputs;
    }

    throw new Error(`disconnectAudio: nothing wired into ${to.kind === "node" ? `node ${to.index} input ${to.input ?? 0}` : `emitter ${to.emitterIndex}`}.`);
  },

  /** DOC-057: sets `graph.nodes[nodeIndex].params[key]` (overwriting whatever was there, adding the key if it wasn't) — the one editing primitive every typed param widget (number/enum/boolean, `audio-canvas`'s `audio-node-registry.ts`) commits through. */
  setNodeParam(document: EditorDocument, graphIndex: number, nodeIndex: number, key: string, value: unknown): Command {
    const graph = getAudioGraph(document.json, graphIndex);
    if (graph.nodes[nodeIndex] === undefined) {
      throw new Error(`No audio-graph node at index ${nodeIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "params", key];
    const fragment = setPathFragment(document.json, path, value);
    return {
      id: makeCommandId("set-audio-node-param"),
      label: `Set ${key} on audio node ${nodeIndex}`,
      coalesceKey: `audio-node-param:${graphIndex}:${nodeIndex}:${key}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** DOC-058: sets the canvas position of a REAL audio-graph node, stored at `graph.nodes[nodeIndex].extras.gltfi.{x,y}` (DOC-027's convention, one level down — see this file's header comment). Synthetic source/emitter terminal node positions are NOT stored here (they are not `graph.nodes[]` entries) — see `SceneEdit.setAudioSourceProperty`/`setAudioEmitterProperty` (DOC-062) for those. */
  setNodePosition(document: EditorDocument, graphIndex: number, nodeIndex: number, x: number, y: number): Command {
    const graph = getAudioGraph(document.json, graphIndex);
    if (graph.nodes[nodeIndex] === undefined) {
      throw new Error(`No audio-graph node at index ${nodeIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "extras", "gltfi"];
    const fragment = setPathFragment(document.json, path, { x, y });
    return {
      id: makeCommandId("set-audio-node-position"),
      label: `Move audio node ${nodeIndex}`,
      coalesceKey: `audio-node-position:${graphIndex}:${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-064: wholesale-replaces `graph.nodes[graphIndex]` with `newGraph` —
   * the Audio Script tab's Apply mechanism, mirroring `GraphEdit
   * .replaceGraph` exactly (read-before-write via `getAudioGraph` so a
   * missing graph fails fast with this file's usual "No KHR_audio_graph
   * graph at index N" message, then one `setPathFragment` over the WHOLE
   * graph object rather than this file's usual per-array whole-replace
   * strategy — `exportAudioGraph`'s output already IS a complete
   * `AudioGraphSpec`, so there is no per-field diffing to do). One
   * `Command` = one undo/redo step ("Apply audio script"), same as
   * `replaceGraph`'s "Apply script". Node-position note (same accepted
   * behavior as `replaceGraph`, `specs/ux-audio-script.md` UX-1400):
   * `newGraph.nodes[].extras.gltfi` positions are whatever the parsed
   * script produced (usually none, since @gltf-audiograph's `parse-ts`
   * has no concept of canvas layout) — `audio-canvas` re-lays-out via ELK
   * on the next render for any node missing a position, so reshaped nodes
   * simply lose their prior spot rather than erroring.
   */
  replaceAudioGraph(document: EditorDocument, graphIndex: number, newGraph: AudioGraphSpec): Command {
    getAudioGraph(document.json, graphIndex);
    const fragment = setPathFragment(document.json, graphPath(graphIndex), newGraph);
    return {
      id: makeCommandId("replace-audio-graph"),
      label: "Apply audio script",
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-063: sets `graph.nodes[nodeIndex].bypass` — the top-level boolean
   * `KHR_audio_graph.node.schema.json` declares on EVERY node kind
   * (distinct from the node's `params` bag, which is why this is its own
   * factory rather than a `setNodeParam` call — `audio-param-panel.tsx`
   * only ever edits `params`). Resolves `specs/ux-audio-graph.md`'s
   * `OPEN(UX-audiograph-bypass-tbd)`. `AudioGraphJS`'s vendored runtime
   * (`parse-layered.ts`'s `parseGraph`, `runtime/preprocess.ts`'s
   * `applyBypass`) already reads this exact field end-to-end — a
   * bypassed node is fully excised from the built Web Audio graph and its
   * upstream/downstream connections rewired directly around it — so no
   * runtime change was needed for a toggle here to take effect the next
   * time `AudioGraphHost.audition()` (re)builds the graph.
   */
  setNodeBypass(document: EditorDocument, graphIndex: number, nodeIndex: number, bypass: boolean): Command {
    const graph = getAudioGraph(document.json, graphIndex);
    if (graph.nodes[nodeIndex] === undefined) {
      throw new Error(`No audio-graph node at index ${nodeIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "bypass"];
    const fragment = setPathFragment(document.json, path, bypass);
    return {
      id: makeCommandId("set-audio-node-bypass"),
      label: `${bypass ? "Bypass" : "Un-bypass"} audio node ${nodeIndex}`,
      coalesceKey: `audio-node-bypass:${graphIndex}:${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  }
};
